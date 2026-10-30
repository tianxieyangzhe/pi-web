import "server-only";
import {isRoleSnapshot} from "@/domain/agent-definition";
import fs from "node:fs";
import { createAgentSession, DefaultResourceLoader, SettingsManager, SessionManager, getAgentDir, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { BotRuntimePort, BotRuntimeInput, BotNativeEvidence, BotTool } from "@/application/ports/bot";
import { assertBotBudget, botInputByteLimit, validateBotResult, safeBotContent, type BotExecutionResult, type PiNativeRef } from "@/domain/bot";
import { DomainError } from "@/domain/errors";
import { emptyInspection } from "@/domain/native-context";
import { createPiEventMapper, piSessionRuntime } from "./pi-session-runtime.server";
import { projectTranscriptEntries } from "./transcript-projection";
import { appendMessageReferences } from "./message-references.server";
import { createMessageReferenceScope } from "./message-reference-scope.server";
import { createOpenAIModelRuntime } from "./openai-model-config.server";
import { createPiProjectTools } from "../projects/pi-project-tools.server";
import { toPiBotTools } from "./pi-bot-tools.server";
import { buildBotRuntimeToolInstructions } from "./bot-runtime-instructions";
import { assertSafeReceivedTranscript, botMessageEntries, botModelFailure } from './bot-runtime-failure';
import { sessionRepository } from "../database/session-repository.server";
import type { SessionRuntimeInput } from "@/application/ports/pi-runtime";
type Handle = {
  session: AgentSession;
  referenceScope: ReturnType<typeof createMessageReferenceScope>;
  manager: SessionManager;
  cwd: string;
};
function text(content: unknown) {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.map(p => p.type === 'text' ? p.text : '').join('') : '';
}
function evidence(manager: SessionManager, start: string | null): BotNativeEvidence[] {
  const branch = manager.getBranch(),
    i = start ? branch.findIndex(e => e.id === start) : -1;
  const toolNames = new Map<string, string>();
  for (const entry of branch) {
    if (entry.type !== "message") continue;
    const m = entry.message as {
      role: string;
      content: unknown;
    };
    if (m.role === 'assistant' && Array.isArray(m.content)) for (const part of m.content) if (part.type === 'toolCall') toolNames.set(part.id, part.name);
  }
  return branch.slice(i + 1).flatMap<BotNativeEvidence>(entry => {
    if (entry.type !== 'message') return [];
    const m = entry.message as {
      role: string;
      content: unknown;
      isError?: boolean;
      stopReason?: string;
      toolCallId?: string;
    };
    if (m.role === 'assistant') {
      const t = safeBotContent(text(m.content));
      return t ? [{
        id: entry.id,
        text: t.slice(0, 4000),
        kind: 'assistant' as const,
        failed: m.stopReason === 'error'
      }] : [];
    }
    if (m.role === 'toolResult') {
      const name = toolNames.get(m.toolCallId ?? '') ?? 'tool';
      if (name.startsWith('bot_')) return [];
      return [{
        id: entry.id,
        text: `${name}: ${m.isError ? '执行失败' : '已执行'}`,
        kind: 'tool' as const,
        failed: m.isError === true
      }];
    }
    return [];
  });
}
const outputInstructions = `完成任务或问答时调用 bot_report_result，提供真实结果。先调用 bot_evidence 获取当前执行中的证据条目 ID；不得凭空编造检查通过。若本次证据明确显示绑定 Agent.md 与用户目标、实际工具或真实行为冲突，在 agentDefinitionIssue 中给出中性疑点摘要和对应 evidenceEntryIds，并把 verification 设为 failed 或 not_run；不确定或无本次证据时不要报告。协调者收到疑点后在总对话如实提示用户并等待其选择，不自行改写、保存或授予能力。只有当前协调执行已开始或继续一个明确 Work 时才填写 workOutcome；所有必要任务已验收且无待答、队列或 unknown 执行时才填写 completed，明确无法完成才填写 failed，普通聊天不填。未验证标 not_run。最终回答使用普通公开文字，禁止泄露原始思考。`;
class BotRuntime implements BotRuntimePort {
  private handles = new Map<string, Handle>();
  private model: ReturnType<typeof createOpenAIModelRuntime> | undefined;
  private configured() {
    return this.model ??= createOpenAIModelRuntime();
  }
  private async handle(input: BotRuntimeInput, additional: BotTool[] = [], onRef?: (r: PiNativeRef) => void): Promise<Handle> {
    if (input.signal?.aborted) throw new DomainError('REQUEST_ABORTED', '执行已停止', 409, true);
    const toolInstructions = buildBotRuntimeToolInstructions(input.tools.map(tool => tool.name), !!input.projectSessionId);
    const live = input.projectSessionId ? piSessionRuntime.getHandle(input.projectSessionId) as Handle | undefined : this.handles.get(input.identity);
    if (input.nativeRef && !live) {
      if (!fs.existsSync(input.nativeRef.sessionFile) || fs.statSync(input.nativeRef.sessionFile).size === 0) throw new DomainError('NO_NATIVE_REF', 'Pi 原生历史文件缺失，未新建替代', 409, true);
      const manager = SessionManager.open(input.nativeRef.sessionFile, undefined, input.cwd);
      if (manager.getSessionId() !== input.nativeRef.sessionId || manager.getHeader()?.cwd !== input.cwd) throw new DomainError('NO_NATIVE_REF', 'Pi 原生身份不一致', 409, true);
    }
    if (input.projectSessionId) {
      const session = sessionRepository.get(input.projectSessionId);
      if (!session) throw new DomainError('NOT_FOUND', '项目会话不存在', 404, true);
      if (input.allowWrite && (!isRoleSnapshot(session.agentSnapshot)||!session.agentSnapshot.definition.capabilities.writeFiles)) throw new DomainError('PROJECT_WRITE_DENIED', '项目 Agent 不允许修改文件', 409, true);
      if (session.mcpIds.length) throw new DomainError('RESOURCE_UNAVAILABLE', '当前项目执行配置尚未接入', 409, true);
      const runInput: SessionRuntimeInput = {
        session,
        workingDirectory: input.cwd,
        allowProjectWrite: input.allowWrite,allowProjectRead:input.allowRead,
        roleInstructions: input.instructions + '\n' + toolInstructions + '\n' + outputInstructions,
        collaborationTools: [...input.tools, ...additional],
        executionIdentity: input.executionId
      };
      let handle = piSessionRuntime.getHandle(session.id, runInput) as Handle | undefined;
      if (!handle) {
        if (session.nativeRef) handle = (await piSessionRuntime.restore(runInput)) as Handle;else {
          const opened = await piSessionRuntime.open(runInput);
          handle = opened.handle as Handle;
          onRef?.(opened.nativeRef as PiNativeRef);
        }
      }
      return handle;
    }
    const old = this.handles.get(input.identity);
    if (old && !old.session.isIdle) throw new DomainError('SESSION_BUSY', '总对话正在运行', 409, true);
    if (old && old.cwd === input.cwd) return old;
    if (old) {
      old.session.dispose();
      this.handles.delete(input.identity);
    }
    const manager = input.nativeRef ? SessionManager.open(input.nativeRef.sessionFile, input.sessionDirectory, input.cwd) : SessionManager.create(input.cwd, input.sessionDirectory);
    const {
      runtime: modelRuntime,
      model
    } = await this.configured();
    const referenceScope = createMessageReferenceScope();
    const loader = new DefaultResourceLoader({
      extensionFactories: [referenceScope.extension],
      cwd: input.cwd,
      agentDir: getAgentDir(),
      noExtensions: true,
      noSkills: true,
      noContextFiles: true,
      noPromptTemplates: true,
      noThemes: true,
      systemPrompt: input.instructions + '\n' + toolInstructions + '\n' + outputInstructions
    });
    await loader.reload();
    const fileTools = await createPiProjectTools({
      session: {agentSnapshot:{agentId:'inspection',kind:'coordinator',revision:1,botId:null,projectId:null,contentSha256:'0'.repeat(64),name:'workspace',description:null,definition:{instructions:'workspace',capabilities:{readFiles:input.allowRead===true,writeFiles:input.allowWrite,readProjects:false,dispatchTasks:false,dispatchProjectWrites:false,exchangeMessages:false}}}} as SessionRuntimeInput['session'],
      workingDirectory: input.cwd,
      allowProjectWrite: input.allowWrite,allowProjectRead:input.allowRead
    });
    const {
      session
    } = await createAgentSession({
      cwd: input.cwd,
      modelRuntime,
      model,
      resourceLoader: loader,
      settingsManager: SettingsManager.inMemory({
        compaction: {
          enabled: false
        }
      }),
      sessionManager: manager,
      noTools: 'builtin',
      customTools: [...fileTools, ...toPiBotTools([...input.tools, ...additional])]
    });
    const handle = {
      session,
      referenceScope,
      manager,
      cwd: input.cwd
    };
    this.handles.set(input.identity, handle);
    if (!input.nativeRef) onRef?.({
      kind: 'pi',
      sessionFile: manager.getSessionFile()!,
      sessionId: manager.getSessionId(),
      cwd: input.cwd
    });
    return handle;
  }
  async run(input: BotRuntimeInput, content: string, onRef: (ref: PiNativeRef) => void, emit: Parameters<BotRuntimePort['run']>[3]) {
    let handle: Handle | undefined,
      startId: string | null = null,
      result: BotExecutionResult | null = null;
    const additional: BotTool[] = input.kind === "coordinator" ? [] : [{
      name: 'bot_evidence',
      description: '取得本次执行公开文本及安全证据 ID，不含原始 thinking。',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      execute: async () => handle ? evidence(handle.manager, startId) : []
    }, {
      name: 'bot_report_result',
      description: '报告本次真实结果、等待问题与验收证据，未验证不能标通过。',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string'
          },
          verification: {
            type: 'string',
            enum: ['passed', 'failed', 'not_run']
          },
          checks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                criterion: {
                  type: 'string'
                },
                outcome: {
                  type: 'string',
                  enum: ['passed', 'failed', 'not_run']
                },
                evidence: {
                  type: 'string'
                },
                sourceEntryIds: {
                  type: 'array',
                  items: {
                    type: 'string'
                  }
                }
              },
              required: ['criterion', 'outcome', 'evidence', 'sourceEntryIds'],
              additionalProperties: false
            }
          },
          outputs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: {
                  type: 'string'
                },
                summary: {
                  type: 'string'
                },
                path: {
                  type: ['string', 'null']
                }
              },
              required: ['title', 'summary', 'path'],
              additionalProperties: false
            }
          },
          blockers: {
            type: 'array',
            items: {
              type: 'string'
            }
          },
          agentDefinitionIssue: {
            type: 'object',
            properties: {
              summary: {type:'string'},
              evidenceEntryIds: {type:'array',items:{type:'string'}}
            },
            required: ['summary','evidenceEntryIds'],
            additionalProperties: false
          }
          ,...(input.allowWorkOutcome?{workOutcome:{type:'string',enum:['completed','failed']}}:{})
        },
        required: ['summary', 'verification', 'checks', 'outputs', 'blockers'],
        additionalProperties: false
      },
      execute: async args => {
        result = validateBotResult(args);
        return {
          accepted: true
        };
      }
    }];
    const toolInstructions=buildBotRuntimeToolInstructions(input.tools.map(tool=>tool.name),!!input.projectSessionId);
    const {model}=await this.configured();
    assertBotBudget(input.instructions+'\n'+toolInstructions, content, [...input.tools, ...additional].map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters
    })),botInputByteLimit(model.contextWindow,model.maxTokens));
    handle = await this.handle(input, additional, onRef);
    if (input.signal?.aborted) throw new DomainError('REQUEST_ABORTED', '执行已停止', 409, true);
    if(input.inputMode==='resume_received'){
      if(!input.resumedFromExecutionId||!input.triggerMessageId||!input.inputNativeEntryId)throw new DomainError('RESUME_UNSUPPORTED','继续处理需要准确的原执行、用户消息和 Pi 输入条目引用',409,true);
      assertSafeReceivedTranscript(handle.manager.getBranch(),input.resumedFromExecutionId,input.triggerMessageId,input.inputNativeEntryId);
    }
    startId = handle.manager.getLeafId();
    handle.manager.appendCustomEntry('bot_execution_start', {
      executionId: input.executionId,
      startId,
      inputMode:input.inputMode??'append',
      resumedFromExecutionId:input.resumedFromExecutionId??null,
      triggerMessageId:input.triggerMessageId??null,
      inputNativeEntryId:input.inputNativeEntryId??null
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void handle?.session.abort();
    }, 180000);
    const cancel = () => void handle?.session.abort();
    input.signal?.addEventListener('abort', cancel, {
      once: true
    });
    const mapEvent = createPiEventMapper(true, input.cwd, emit);
    const unsubscribe = handle.session.subscribe(mapEvent);
    try {
      handle.session.setAutoCompactionEnabled(false);
      if (input.signal?.aborted) throw new DomainError('REQUEST_ABORTED', '执行已停止', 409, true);
      const referenceTurnId = handle.referenceScope.begin();
      if(input.inputMode==='resume_received')await handle.session.sendCustomMessage({customType:'bot_received_resume',content:[{type:'text',text:content}],display:false,details:{executionId:input.executionId,messageId:input.triggerMessageId,resumedFromExecutionId:input.resumedFromExecutionId,inputNativeEntryId:input.inputNativeEntryId}},{triggerTurn:true});
      else { await appendMessageReferences(handle.session, input.referenceContent, referenceTurnId); await handle.session.prompt(content, {expandPromptTemplates:false}); }
      if(input.triggerMessageId){
        const inputEntry=handle.manager.getBranch().filter(entry=>entry.type==='message').at(-1);
        if(inputEntry)handle.manager.appendCustomEntry('bot_input_link',{executionId:input.executionId??null,messageId:input.triggerMessageId,inputNativeEntryId:inputEntry.id});
      }
      const last = handle.session.messages.filter(x => x.role === 'assistant').at(-1) as {
        stopReason?: string;
        errorMessage?: string;
      } | undefined;
      if (timedOut) throw new DomainError('BOT_TIMEOUT', '本次执行超时，已产生历史保留', 409, true);
      if (last?.stopReason === 'aborted') throw new DomainError('REQUEST_ABORTED', '执行已停止', 409, true);
      if (last?.stopReason === 'error') { if (input.referenceContent?.some(item => item.type === 'image')) throw new DomainError('RUNTIME_ERROR', '模型请求失败；模型或服务可能不支持图片输入', 503, true); throw botModelFailure(last.errorMessage); }
      if (input.kind === "coordinator") emit({ type: "complete" });
      const endId = handle.manager.getLeafId();
      const entries = handle.manager.getBranch();
      const messageEntryIds: Record<string, string> = {};
      Object.assign(messageEntryIds, botMessageEntries(entries, startId));
      const sources = evidence(handle.manager, startId);
      const from=startId?entries.findIndex(x=>x.id===startId):-1,to=entries.findIndex(x=>x.id===endId);if(to<0||startId&&from<0)throw new DomainError('EXECUTION_UNCERTAIN','原生执行边界缺失',409,true);
      const reported = result as BotExecutionResult | null;
      if (sources.some(e => e.failed) && reported) {
        result = validateBotResult({
          ...reported,
          verification: 'failed',
          blockers: [...reported.blockers, '本次有工具执行失败'].slice(0, 20)
        });
      }
      handle.manager.appendCustomEntry('bot_execution_end', {
        executionId: input.executionId,
        startId,
        endId,
        result
      });
      return {
        startId,
        endId,
        evidence: sources,
        result,
        messageEntryIds:input.inputMode==='resume_received'&&input.triggerMessageId&&input.inputNativeEntryId?{[input.triggerMessageId]:input.inputNativeEntryId}:messageEntryIds
      };
    } catch (cause) {
      const sources = evidence(handle.manager, startId);
      const partial: BotExecutionResult = {
        summary: sources.filter(e => e.kind === 'assistant').at(-1)?.text.slice(0, 4000) || '执行未成功完成',
        verification: 'not_run',
        checks: [],
        outputs: (result as BotExecutionResult | null)?.outputs ?? [],
        blockers: [cause instanceof DomainError ? cause.message : 'Pi 执行失败']
      };
      if (cause && typeof cause === 'object') Object.assign(cause, {
        partialResult: partial,
        messageEntryIds: botMessageEntries(handle.manager.getBranch(), startId),
        nativeStartEntryId:startId
      });
      throw cause;
    } finally {
      handle.referenceScope.end();
      clearTimeout(timer);
      unsubscribe();
      input.signal?.removeEventListener('abort', cancel);
    }
  }
  async abort(identity: string) {
    const h = identity.startsWith('bot:') ? this.handles.get(identity) : piSessionRuntime.getHandle(identity) as Handle | undefined;
    await h?.session.abort();
  }
  async steer(identity: string, content: string, messageId?: string) {
    const h = identity.startsWith('bot:') ? this.handles.get(identity) : piSessionRuntime.getHandle(identity) as Handle | undefined;
    if (!h) throw new DomainError('SESSION_BUSY', '运行时不可用', 409, true);
    await h.session.prompt(content, {
      expandPromptTemplates: false,
      streamingBehavior: 'steer'
    });
    if(messageId){
      const inputEntry=h.manager.getBranch().filter(entry=>entry.type==='message').at(-1);
      if(inputEntry)h.manager.appendCustomEntry('bot_input_link',{executionId:null,messageId,inputNativeEntryId:inputEntry.id});
    }
  }
  async inspect(input: BotRuntimeInput) {
    if (!input.nativeRef) return emptyInspection('发送首条消息后可管理');
    let h = this.handles.get(input.identity);
    if (!h) h = await this.handle(input);
    const usage = h.session.getContextUsage(),
      window = (await this.configured()).knownContextWindow;
    const value = emptyInspection('用量暂不可用');
    value.runtimeReady = true;
    value.sessionState = h.session.isIdle ? 'idle' : 'running';
    value.canCompact = h.session.isIdle && h.manager.getBranch().filter(e => e.type === 'message').length > 2;
    value.unavailableReason = value.canCompact ? null : '当前不可压缩或会话较短';
    const tokens = usage?.tokens ?? null;
    value.usage = {
      usedTokens: tokens,
      contextWindowTokens: window,
      remainingTokens: tokens !== null && window !== null ? Math.max(0, window - tokens) : null,
      usageRatio: tokens !== null && window !== null ? tokens / window : null,
      measurement: tokens === null ? 'unavailable' : 'estimated',
      measuredAt: tokens === null ? null : new Date().toISOString(),
      freshness: tokens === null ? 'unavailable' : 'current'
    };
    value.lastCompactedAt = h.manager.getBranch().filter(e => e.type === 'compaction').at(-1)?.timestamp ?? null;
    return value;
  }
  async compact(input: BotRuntimeInput) {
    const h = this.handles.get(input.identity) ?? (await this.handle(input));
    h.session.setAutoCompactionEnabled(false);
    await h.session.compact();
  }
  cancelCompaction(identity: string) {
    this.handles.get(identity)?.session.abortCompaction();
  }
  async messages(input: BotRuntimeInput) {
    if (!input.nativeRef) return [];
    const live = this.handles.get(input.identity);
    if (!live && (!fs.existsSync(input.nativeRef.sessionFile) || fs.statSync(input.nativeRef.sessionFile).size === 0)) throw new DomainError('NO_NATIVE_REF', '原生历史不可用，未新建替代', 409, true);
    const manager = live?.manager ?? SessionManager.open(input.nativeRef.sessionFile, undefined, input.cwd);
    if (manager.getSessionId() !== input.nativeRef.sessionId || manager.getHeader()?.cwd !== input.cwd) throw new DomainError('NO_NATIVE_REF', '原生历史归属不一致', 409, true);
    return projectTranscriptEntries(manager.getBranch(),{workingDirectory:input.cwd,coordinatorExecutionIds:input.coordinatorExecutionIds,sanitize:safeBotContent});
  }
  async resolve(input: BotRuntimeInput, executionId: string) {
    if (!input.nativeRef) return {
      endId: null,
      evidence: [],
      result: null
    };
    if (!fs.existsSync(input.nativeRef.sessionFile) || fs.statSync(input.nativeRef.sessionFile).size === 0) throw new DomainError('NO_NATIVE_REF', '原生历史不可用', 409, true);
    const manager = SessionManager.open(input.nativeRef.sessionFile, undefined, input.cwd);
    if(manager.getSessionId()!==input.nativeRef.sessionId||manager.getHeader()?.cwd!==input.cwd)throw new DomainError('NO_NATIVE_REF','原生恢复身份不一致',409,true);
    const entry = manager.getBranch().find(e => e.type === 'custom' && e.customType === 'bot_execution_end' && (e.data as {
      executionId?: string;
    })?.executionId === executionId);
    if (entry?.type !== 'custom') return {
      endId: null,
      evidence: [],
      result: null
    };
    const data = entry.data as {
      startId: string | null;
      endId: string | null;
      result: unknown;
    };
    const branch = manager.getBranch(),
      from = data.startId ? branch.findIndex(e => e.id === data.startId) : -1,
      to = branch.findIndex(e => e.id === data.endId);
    if(to<0||data.startId&&from<0||to<=from)throw new DomainError('EXECUTION_UNCERTAIN','原生恢复边界缺失或顺序错误',409,true);
    const messageEntryIds = botMessageEntries(branch.slice(0, to + 1), data.startId);
    return {
      endId: data.endId,
      messageEntryIds,
      evidence: evidence(manager, data.startId).filter(x => {
        const branch = manager.getBranch();
        return branch.findIndex(e => e.id === x.id) <= branch.findIndex(e => e.id === data.endId);
      }),
      result: data.result ? validateBotResult(data.result) : null
    };
  }
  async resolveMessageDelivery(input:BotRuntimeInput,messageId:string):Promise<string|null>{
    if(!input.nativeRef)return null;
    if(!fs.existsSync(input.nativeRef.sessionFile)||fs.statSync(input.nativeRef.sessionFile).size===0)throw new DomainError('NO_NATIVE_REF','Pi 原生历史不可用，不能确认消息送达',409,true);
    const manager=SessionManager.open(input.nativeRef.sessionFile,undefined,input.cwd);
    if(manager.getSessionId()!==input.nativeRef.sessionId||manager.getHeader()?.cwd!==input.cwd)throw new DomainError('NO_NATIVE_REF','Pi 原生历史身份不匹配，不能确认消息送达',409,true);
    return botMessageEntries(manager.getBranch(),null)[messageId]??null;
  }
}
export const botRuntime = new BotRuntime();
