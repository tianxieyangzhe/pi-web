import {requestScopeInstructions} from "@/domain/execution-operation";
import { appendMessageReferences } from "./message-references.server";
import { createMessageReferenceScope } from "./message-reference-scope.server";
import {sameRuntimeConfiguration} from "@/domain/runtime-configuration";
import {isRoleSnapshot} from "@/domain/agent-definition";
import {sessionMemorySummaryPrompt,prepareSessionMemorySummaryInput} from "./session-memory-summary-prompt";
import type {PiContextPort} from "@/application/ports/pi-context";
import type {
  AgentEvent,
  Agent,
  JsonObject,
  Session,
} from "@/domain/models";
import {existsSync,statSync} from "node:fs";
import { safeToolTarget } from "./tool-target";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
  findCutPoint,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession as PiAgentSession } from "@earendil-works/pi-coding-agent";
import type { PiRuntimePort, SessionRuntimeInput } from "@/application/ports/pi-runtime";
import { createPiProjectTools } from "@/infrastructure/projects/pi-project-tools.server";
import { createOpenAIModelRuntime } from "@/infrastructure/pi/openai-model-config.server";

import { DomainError } from "@/domain/errors";
import { emptyInspection, type NativeContextInspection } from "@/domain/native-context";
import type { SessionMemoryHistory, SummaryRequest } from "@/application/ports/session-memory-runtime";
import { validateContext, type SessionMemoryContext } from "@/domain/session-memory";
import {toPiBotTools} from "./pi-bot-tools.server";
import {projectTranscriptEntries} from "./transcript-projection";

type Handle = {
  session: PiAgentSession;
  referenceScope: ReturnType<typeof createMessageReferenceScope>;
  manager: SessionManager;
  cwd: string;
  isProjectSession: boolean;
  input: SessionRuntimeInput;
};

type PiEvent = {
  type?: string;
  id?: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  assistantMessageEvent?: {
    type?: string;
    contentIndex?: number;
    delta?: string;
    content?: unknown;
    toolCall?: { id?: string; name?: string; arguments?: unknown };
  };
  delta?: string;
  result?: unknown;
  args?: unknown;
  partialResult?: unknown;
};

const PUBLIC_SUMMARY_OPEN = "[[PI_PUBLIC_SUMMARY]]";
const PUBLIC_SUMMARY_CLOSE = "[[/PI_PUBLIC_SUMMARY]]";

type TurnState = {
  publicText: string;
  toolDetails: Map<string, string | undefined>;
};

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const item = part as { type?: string; text?: string; thinking?: string };
      return item.type === "text" ? item.text ?? "" : "";
    })
    .join("");
}

function nativeRef(session: PiAgentSession, manager: SessionManager, cwd: string): JsonObject {
  const sessionFile = session.sessionFile ?? manager.getSessionFile();
  if (!sessionFile) throw new Error("Pi 没有返回可恢复的原生 Session 文件");
  return {
    kind: "pi",
    sessionFile,
    sessionId: session.sessionId,
    cwd,
  };
}

export function visibleToolLabel(toolName: string): string {
  const labels: Record<string, string> = {
    bash: "执行命令",
    edit: "编辑文件",
    find: "查找文件",
    grep: "搜索内容",
    ls: "浏览目录",
    project_edit: "修改项目文件",
    project_list: "浏览项目目录",
    project_read: "读取项目文件",
    project_write: "写入项目文件",
    read: "读取文件",
    write: "写入文件",
  };
  const safeName = toolName.replace(/[^\p{L}\p{N}_.:-]/gu, "").slice(0, 80);
  const label = Object.prototype.hasOwnProperty.call(labels, toolName) ? labels[toolName] : "";
  if (label && safeName) return `${label}（${safeName}）`;
  return safeName || "执行已授权工具";
}

export function safePublicSummary(value: string, workingDirectory: string): string {
  return value
    .replaceAll(workingDirectory, "项目根目录")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._~+/-]+=*)\b/gi, "[已隐藏敏感信息]")
    .replace(/\b((?:OPENAI|API|ACCESS|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)?\s*[:=]\s*)[^\s,;]+/gi, "$1[已隐藏]")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, 600);
}

export function extractPublicSummary(value: string): { summary?: string; text: string } {
  const openIndex = value.indexOf(PUBLIC_SUMMARY_OPEN);
  if (openIndex < 0) return { text: value };
  const closeIndex = value.indexOf(PUBLIC_SUMMARY_CLOSE, openIndex + PUBLIC_SUMMARY_OPEN.length);
  if (closeIndex < 0) return { text: value.slice(0, openIndex) };
  return {
    summary: value.slice(openIndex + PUBLIC_SUMMARY_OPEN.length, closeIndex),
    text: value.slice(0, openIndex) + value.slice(closeIndex + PUBLIC_SUMMARY_CLOSE.length),
  };
}

function loaderFor(input: SessionRuntimeInput, referenceScope: ReturnType<typeof createMessageReferenceScope>): DefaultResourceLoader {
  const agent = input.session.agentSnapshot;
  const loader = new DefaultResourceLoader({
    noExtensions: true,
    extensionFactories: [referenceScope.extension],
    noSkills:true,noContextFiles:true,noPromptTemplates:true,
    cwd: input.workingDirectory,
    agentDir: getAgentDir(),
    additionalSkillPaths: [],
    appendSystemPrompt: [
      requestScopeInstructions,
      ...(input.roleInstructions ? [input.roleInstructions] : []),
      ...(isRoleSnapshot(agent)&&!input.roleInstructions?[agent.definition.instructions]:[]),
      
    ],
  });
  return loader;
}

function mapEvent(
  event: PiEvent,
  emit: (event: AgentEvent) => void,
  turn: TurnState,
  workingDirectory: string,
): void {
  const modelEvent = event.assistantMessageEvent;
  const emitResponseText = (text: string) => {
    if (!text) return;
    turn.publicText += text;
    emit({ type: "message_delta", text });
  };
  if (event.type === "turn_start") {
    turn.publicText = "";
    turn.toolDetails.clear();
    return;
  }
  if (event.type === "message_update" && (modelEvent?.type === "thinking_start" || modelEvent?.type === "thinking_delta" || modelEvent?.type === "thinking_end")) {
    return;
  }
  if (event.type === "message_update" && modelEvent?.type === "text_delta") {
    emitResponseText(modelEvent.delta ?? "");
    return;
  }
  if (event.type === "message_update" && modelEvent?.type === "toolcall_end") {
    const toolCall = modelEvent.toolCall;
    if (toolCall?.id) turn.toolDetails.set(toolCall.id, safeToolTarget(toolCall.name ?? "", toolCall.arguments, workingDirectory));
    return;
  }
  if (event.type === "tool_execution_start") {
    emit({
      type: "activity",
      id: `tool-${event.toolCallId ?? event.toolName ?? "unknown"}`,
      kind: "tool",
      state: "running",
      summary: event.toolName || "tool",
      ...(turn.toolDetails.get(event.toolCallId ?? "") ? { detail: turn.toolDetails.get(event.toolCallId ?? "") } : {}),
    });
    return;
  }
  if (event.type === "tool_execution_update") {
    emit({
      type: "activity",
      id: `tool-${event.toolCallId ?? event.toolName ?? "unknown"}`,
      kind: "tool",
      state: "running",
      summary: event.toolName || "tool",
      ...(turn.toolDetails.get(event.toolCallId ?? "") ? { detail: turn.toolDetails.get(event.toolCallId ?? "") } : {}),
    });
    return;
  }
  if (event.type === "tool_execution_end") {
    emit({
      type: "activity",
      id: `tool-${event.toolCallId ?? event.toolName ?? "unknown"}`,
      kind: "tool",
      state: event.isError ? "error" : "completed",
      summary: `${event.isError ? "失败：" : ""}${event.toolName || "tool"}`,
      ...(turn.toolDetails.get(event.toolCallId ?? "") ? { detail: turn.toolDetails.get(event.toolCallId ?? "") } : {}),
    });
    return;
  }
  
}

export function createPiEventMapper(showActionSummary: boolean, workingDirectory: string, emit: (event: AgentEvent) => void) {
  const turn: TurnState = {
    publicText: "",
    toolDetails: new Map(),
  };
  return (event: unknown) => mapEvent(event as PiEvent, emit, turn, workingDirectory);
}

class PiSessionRuntime implements PiRuntimePort, PiContextPort {
  private readonly handles = new Map<string, Handle>();
  private modelRuntime: ReturnType<typeof createOpenAIModelRuntime> | undefined;

  private configuredModel() {
    this.modelRuntime ??= createOpenAIModelRuntime();
    return this.modelRuntime;
  }

  private async create(input: SessionRuntimeInput, manager: SessionManager): Promise<Handle> {
    const referenceScope = createMessageReferenceScope();
    const loader = loaderFor(input, referenceScope);
    await loader.reload();
    const { runtime: modelRuntime, model } = await this.configuredModel();
    const customTools = [
      ...(await createPiProjectTools(input)),
      ...toPiBotTools(input.collaborationTools ?? []),
    ];
    const result = await createAgentSession({
      cwd: input.workingDirectory,
      sessionManager: manager,
      modelRuntime,
      resourceLoader: loader,
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
      model,
      noTools: customTools.length ? "builtin" : "all",
      ...(customTools.length ? { customTools } : {}),

    });
    return {
      session: result.session,
      referenceScope,
      manager,
      cwd: input.workingDirectory,
      isProjectSession: input.projectSession !== false,
      input,
    };
  }

  async open(input: SessionRuntimeInput) {
    const manager = SessionManager.create(input.workingDirectory);
    const handle = await this.create(input, manager);
    this.handles.set(input.session.id, handle);
    return { handle, nativeRef: nativeRef(handle.session, manager, input.workingDirectory) };
  }

  async restore(input: SessionRuntimeInput) {
    const reference = input.session.nativeRef;
    const sessionFile = reference?.sessionFile;
    if (typeof sessionFile !== "string" || !sessionFile) throw new Error("Pi 原生 Session 引用无效");
    if(!existsSync(sessionFile)||statSync(sessionFile).size===0)throw new DomainError("NO_NATIVE_REF","Pi 原生历史缺失，未新建替代",409,true);
    const manager = SessionManager.open(sessionFile, undefined, input.workingDirectory);
    if(manager.getSessionId()!==reference?.sessionId||manager.getHeader()?.cwd!==input.workingDirectory)throw new DomainError("NO_NATIVE_REF","Pi 原生历史归属不一致",409,true);
    const handle = await this.create(input, manager);
    this.handles.set(input.session.id, handle);
    return handle;
  }

  async send(handle: object, message: string, emit: (event: AgentEvent) => void, onAssistantStream?: () => void, references?: import("@/domain/message-references").ReferenceContent) {
    const piHandle = handle as Handle;
    const turn: TurnState = {
      publicText: "",
      toolDetails: new Map(),
    };
    let assistantStreamSeen = false;
    const unsubscribe = piHandle.session.subscribe((event) => {
      if (!assistantStreamSeen && event.type === "message_update") {
        assistantStreamSeen = true;
        onAssistantStream?.();
      }
      mapEvent(event as PiEvent, emit, turn, piHandle.cwd);
    });
    try {
      piHandle.session.setAutoCompactionEnabled(false);
      const referenceTurnId = piHandle.referenceScope.begin();
      await appendMessageReferences(piHandle.session, references, referenceTurnId);
      await piHandle.session.prompt(message, { expandPromptTemplates: false });
      const last=piHandle.session.messages.filter(item=>item.role==="assistant").at(-1) as {stopReason?:string;errorMessage?:string} | undefined;
      if(last?.stopReason==="error") { if(/context|token.*limit|maximum.*length/i.test(last.errorMessage??""))throw new DomainError("CONTEXT_LIMIT_REACHED","原生上下文已满，请在检查中手动压缩后重新发送",409,true);throw new DomainError("RUNTIME_ERROR", references?.some(item => item.type === "image") ? "模型请求失败；模型或服务可能不支持图片输入" : "模型请求失败，请检查配置或恢复状态",503,true); }
      if(last?.stopReason==="aborted")throw new DomainError("REQUEST_ABORTED","请求已停止",409,true);
    } finally {
      piHandle.referenceScope.end();
      unsubscribe();
    }
  }

  async interrupt(handle: object) {
    await (handle as Handle).session.abort();
  }

  async projectHandle(input: SessionRuntimeInput) {
    const existing = this.handles.get(input.session.id) ?? (input.session.nativeRef ? await this.restore(input) : (await this.open(input)).handle) as Handle;
    const textOf = (content: unknown) => typeof content === "string" ? content : Array.isArray(content) ? content.map(part => part && typeof part === "object" && "text" in part ? String(part.text ?? "") : "").join("") : "";
    return {
      sessionId: input.session.id,
      subscribe: (listener: (event: { type: "agent_settled"; aborted: boolean; endEntryId: string | null }) => void) => existing.session.subscribe(event => {
        if (event.type !== "agent_end") return;
        const end = [...existing.manager.getBranch()].reverse().find(entry => entry.type === "message" && (entry.message as { role?: string }).role === "assistant");
        listener({ type: "agent_settled", aborted: event.willRetry !== true && !end, endEntryId: end?.id ?? null });
      }),
      prompt: async (content: string) => {
        const before = new Set(existing.manager.getBranch().map(entry => entry.id));
        await existing.session.prompt(content, { expandPromptTemplates: false });
        const start = existing.manager.getBranch().find(entry => !before.has(entry.id) && entry.type === "message" && (entry.message as { role?: string }).role === "user");
        if (!start) throw new DomainError("RUNTIME_ERROR", "项目调用未写入 Pi transcript", 503, true);
        return { startEntryId: start.id };
      },
      steer: async (content: string) => { await existing.session.steer(content); },
      readAssistant: async (startEntryId: string, endEntryId: string) => {
        const branch = existing.manager.getBranch();
        const start = branch.findIndex(entry => entry.id === startEntryId), end = branch.findIndex(entry => entry.id === endEntryId);
        if (start < 0 || end < start) throw new DomainError("INVALID_STATE", "项目调用 transcript 边界无效", 409, true);
        return branch.slice(start, end + 1).flatMap(entry => entry.type === "message" && (entry.message as { role?: string }).role === "assistant" ? [textOf((entry.message as { content?: unknown }).content)] : []).join("\n");
      },
    };
  }

  async readMessages(input: SessionRuntimeInput) {
    let manager: SessionManager;
    const live=this.handles.get(input.session.id);
    if(live)manager=live.manager;
    else if (input.session.nativeRef?.sessionFile && typeof input.session.nativeRef.sessionFile === "string") {
      if(!existsSync(input.session.nativeRef.sessionFile)||statSync(input.session.nativeRef.sessionFile).size===0)throw new DomainError("NO_NATIVE_REF","Pi 原生历史缺失",409,true);
      manager = SessionManager.open(input.session.nativeRef.sessionFile, undefined, input.workingDirectory);
    } else {
      manager = SessionManager.create(input.workingDirectory);
    }
    return projectTranscriptEntries(manager.getBranch(), { workingDirectory: input.workingDirectory, coordinatorExecutionIds: input.coordinatorExecutionIds }).map(message => ({ ...message, sessionId: input.session.id, id: message.id || `${input.session.id}` }));
  }

  private manager(input: SessionRuntimeInput): SessionManager | null {
    const handle = this.handles.get(input.session.id);
    if (handle) return handle.manager;
    const file = input.session.nativeRef?.sessionFile;
    return typeof file === "string" ? SessionManager.open(file, undefined, input.workingDirectory) : null;
  }

  async history(input: SessionRuntimeInput): Promise<SessionMemoryHistory> {
    const entries = this.manager(input)?.getBranch() ?? [];
    const requests: SummaryRequest[] = [];
    let pending: SummaryRequest | undefined;
    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const msg = entry.message as { role?: string; content?: unknown; stopReason?: string };
      const safeText = textContent(msg.content).replaceAll(input.workingDirectory, "项目根目录").replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+\S+)/gi, "[已隐藏]").replace(/((?:OPENAI|API|ACCESS|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\s*[:=]\s*)[^\s,;]+/gi,"$1[已隐藏]");
      if (msg.role === "user") { pending = { afterId: entry.id, throughId: entry.id, user: safeText, assistant: "", completed: false, createdAt: entry.timestamp }; requests.push(pending); }
      else if (msg.role === "assistant" && pending) {
        pending.throughId = entry.id;
        const blocks = Array.isArray(msg.content) ? msg.content as Array<{type?:string}> : [];
        const parsed = extractPublicSummary(safeText).text;
        if (parsed) pending.assistant += (pending.assistant ? "\n" : "") + parsed;
        pending.completed = !!parsed && !blocks.some(block => block.type === "toolCall") && msg.stopReason === "stop";
      }
    }
    return { entryIds: entries.map(entry => entry.id), requests };
  }

  async summarize(context: SessionMemoryContext, requests: SummaryRequest[], cwd: string) {
    const input=prepareSessionMemorySummaryInput(context,requests);
    const {runtime: modelRuntime, model} = await this.configuredModel();
    const loader = new DefaultResourceLoader({cwd, agentDir:getAgentDir(), noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true, systemPrompt: sessionMemorySummaryPrompt});
    await loader.reload();
    const {session} = await createAgentSession({cwd, modelRuntime, model: {...model,maxTokens:4000}, resourceLoader:loader, sessionManager:SessionManager.inMemory(cwd), settingsManager:SettingsManager.inMemory({compaction:{enabled:false}}), noTools:"all", tools:[], thinkingLevel:"off"});
    const timer = setTimeout(() => void session.abort(),45000);
    try {
      await session.prompt(input,{expandPromptTemplates:false});
      const answer = session.messages.filter(msg => msg.role === "assistant").at(-1) as {content?:unknown;usage?:{input?:number;output?:number};stopReason?:string} | undefined;
      if (!answer || answer.stopReason !== "stop") throw new Error("summary failed");
      const raw = textContent(answer.content).trim().replace(/^```(?:json)?\s*|\s*```$/g,"");
      return {context:validateContext(JSON.parse(raw)), inputTokens:answer.usage?.input ?? null, outputTokens:answer.usage?.output ?? null};
    } finally {clearTimeout(timer);session.dispose();}
  }

  async inspect(input: SessionRuntimeInput): Promise<NativeContextInspection> {
    if (!input.session.nativeRef) return emptyInspection("Session 尚未启动");
    let handle = this.handles.get(input.session.id);
    if (!handle && input.session.state === "idle") handle = await this.restore(input) as Handle;
    if (!handle) return emptyInspection("Session 需要恢复后才能读取用量");
    const branch=handle.manager.getBranch();
    const usage=handle.session.getContextUsage();
    const tokens=usage?.tokens ?? null;
    const window=(await this.configuredModel()).knownContextWindow;
    const result=emptyInspection("暂无可靠用量");
    result.runtimeReady=true;
    result.sessionState=input.session.state;
    result.usage={usedTokens:tokens,contextWindowTokens:window,remainingTokens:tokens!==null&&window!==null?Math.max(0,window-tokens):null,usageRatio:tokens!==null&&window!==null?tokens/window:null,measurement:tokens===null?"unavailable":"estimated",measuredAt:tokens===null?null:new Date().toISOString(),freshness:tokens===null?"unavailable":"current"};
    const entries=handle.manager.getBranch();
    const compactionIndex=entries.findLastIndex(entry=>entry.type==="compaction");
    const previous=entries[compactionIndex];
    const firstKept=previous?.type==="compaction"?entries.findIndex(entry=>entry.id===previous.firstKeptEntryId):0;
    const start=firstKept>=0?firstKept:compactionIndex+1;
    const cut=findCutPoint(entries,start,entries.length,handle.session.settingsManager.getCompactionSettings().keepRecentTokens);
    const hasSource=cut.firstKeptEntryIndex>start && entries.at(-1)?.type!=="compaction";
    result.canCompact = input.session.state === "idle" && handle.session.isIdle && hasSource;
    result.unavailableReason = result.canCompact ? null : !hasSource ? "原生会话较短或已经压缩，无需压缩" : "当前 Session 不可压缩";
    result.lastCompactedAt = handle.manager.getBranch().filter(entry => entry.type === "compaction").at(-1)?.timestamp ?? null;
    return result;
  }

  async compact(handle: object) {
    const pi = (handle as Handle).session;
    if (!pi.isIdle) throw new DomainError("SESSION_BUSY","Session 正在运行",409,true);
    pi.setAutoCompactionEnabled(false);
    try { await pi.compact(); } catch(error) { const message=error instanceof Error?error.message:"";if(/Nothing to compact|Already compacted/i.test(message))throw new DomainError("NOTHING_TO_COMPACT","原生会话较短或已经压缩，无需压缩",409,true);throw error; }
  }

  cancelCompaction(handle:object) { (handle as Handle).session.abortCompaction(); }

  async close(handle: object) {
    const piHandle = handle as Handle;
    piHandle.session.dispose();
    for (const [sessionId, value] of this.handles) {
      if (value === piHandle) this.handles.delete(sessionId);
    }
  }

  getHandle(sessionId: string, input?: SessionRuntimeInput) {
    const handle = this.handles.get(sessionId);
    if (!input) return handle;
    if (
      handle && sameRuntimeConfiguration(handle.input,input)
    ) {
      handle.session.setAutoCompactionEnabled(false);
      return handle;
    }
    if (handle) {
      if(!handle.session.isIdle)throw new DomainError("SESSION_BUSY","当前 Pi 正在运行，不能替换配置",409,true);
      handle.session.dispose();
      this.handles.delete(sessionId);
    }
    return undefined;
  }
}

export const piSessionRuntime = new PiSessionRuntime();
