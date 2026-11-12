import { xmlText } from "@/domain/assistant-document";
import { createToolSearchScope, toolSearchNames } from "./tool-search-scope";
import { toolSearchConfiguration, type ToolSearchDependencies } from "./tool-search-client";
import { createServerWebSearchScope, assertServerWebSearch } from "./server-web-search";
import { appendWorkspaceRequest, readWorkspaceRequests, type WorkspaceRequestIdentity } from '@/infrastructure/workspaces/request-journal.server';
import { createPersistentAgentSession } from "./create-session.server";
import { subscribeNativeSession } from "./native-session-events.server";
import {requestScopeInstructions} from "@/domain/execution-operation";
import { appendMessageReferences } from "./message-references.server";
import { sessionContextFiles } from "@/infrastructure/references/session-context-files.server";
type ContextSnapshot = { documents:Array<{path:string;content:string}> };
import { createMessageReferenceScope } from "./message-reference-scope.server";
import {sameRuntimeConfiguration} from "@/domain/runtime-configuration";
import {isRoleSnapshot} from "@/domain/agent-definition";
import type {PiContextPort} from "@/application/ports/pi-context";
import type {
  AgentEvent,
  Agent,
  JsonObject,
  Session,
} from "@/domain/models";
import { closeSync, existsSync, mkdirSync, openSync, rmdirSync, statSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { readNativeFile, readTreeFile, snapshotTree } from "./session-tree.server";
import { safeToolTarget } from "./tool-target";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
  findCutPoint,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession as PiAgentSession, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { PiRuntimePort, SessionRuntimeInput } from "@/application/ports/pi-runtime";
import { loadModelConfiguration, resolveConfiguredModel, resolveSessionModel } from "./model-config.server";
import { branchEntries, fileDigest, persistManager, prepareFork, renderSessionExport } from "./session-artifacts.server";

import {canonical,hash} from "@/domain/project-operations";
import { DomainError } from "@/domain/errors";
import {sessionPreview,type SessionPreview} from "@/domain/session-preview";
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { sessionThinkingLevels, type SessionThinkingLevel, type SessionModelSelection } from '@/domain/session-tools';
import { emptyInspection, type NativeContextInspection } from "@/domain/native-context";
import {projectTranscriptEntries} from "./transcript-projection";

type Handle = {
  deleting?: boolean;
  acceptingSteer?: boolean;
  discardedSteering?: number;
  steeringWrites?: Set<Promise<unknown>>;
  session: PiAgentSession;
  referenceScope: ReturnType<typeof createMessageReferenceScope>;
  searchScope: ReturnType<typeof createServerWebSearchScope>;
  toolSearchScope: ReturnType<typeof createToolSearchScope>;
  manager: SessionManager;
  cwd: string;
  isProjectSession: boolean;
  input: SessionRuntimeInput;
  refreshContext:()=>ContextSnapshot;
  promptDirty?:boolean;
  contextFingerprint?:string;
  useConfiguration:(configuration:Awaited<ReturnType<typeof loadModelConfiguration>>)=>void;
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

function loaderFor(input: SessionRuntimeInput, referenceScope: ReturnType<typeof createMessageReferenceScope>, searchScope: ReturnType<typeof createServerWebSearchScope>, toolSearchScope: ReturnType<typeof createToolSearchScope>): DefaultResourceLoader {
  const loader = new DefaultResourceLoader({noExtensions:true,extensionFactories:[referenceScope.extension,searchScope.extension,toolSearchScope.extension],noSkills:true,noContextFiles:true,noPromptTemplates:true,cwd:input.workingDirectory,agentDir:getAgentDir(),additionalSkillPaths:[],systemPromptOverride:()=>undefined,appendSystemPrompt:[]});
  // Explicit selection is authoritative; do not discover project/global SYSTEM.md.
  loader.getSystemPrompt=()=>{const agent=input.session.agentSnapshot;return isRoleSnapshot(agent)?agent.definition.systemPrompt||undefined:undefined;};
  loader.getAppendSystemPrompt=()=>{
    const agent=input.session.agentSnapshot,definition=isRoleSnapshot(agent)?agent.definition:null;
    const rule=definition?.projects?.[0];
    const projectContext=!input.workspace&&input.assistantContext?input.assistantContext.prompt:!input.workspace&&rule?`<project id="${xmlText(input.session.projectId)}" name="${xmlText(input.projectName??rule.name)}">\n<cwd>${xmlText(input.workingDirectory)}</cwd>\n<rules>${xmlText(rule.rules)}</rules>\n</project>`:'';
    return [requestScopeInstructions,...(input.workspace?[input.workspace.prompt]:input.nativeCodingTools?['本会话使用Pi原生read、bash、edit、write工具；以本轮实际声明的工具为准；可通过bash调用部署已有的Python环境，不擅自安装依赖。项目目录为cwd，不是文件系统沙箱；上传附件原件保持只读，编辑结果另存。']:[]),...(definition?.instructions?[definition.instructions]:[]),...(projectContext?[projectContext]:[])];
  };
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

export class PiSessionRuntime implements PiRuntimePort, PiContextPort {
  constructor(private readonly modelSource: () => Promise<Awaited<ReturnType<typeof loadModelConfiguration>> & { model?: import("@earendil-works/pi-ai").Model<import("@earendil-works/pi-ai").Api> }> = loadModelConfiguration, private readonly toolSearchDependencies: ToolSearchDependencies = {}, private readonly contextFilesSource:(id:string)=>ContextSnapshot = ()=>({documents:[]})) {}
  private readonly handles = new Map<string, Handle>();

  setAssistant(handle:object,assistant:SessionRuntimeInput["session"]["agentSnapshot"],context?:SessionRuntimeInput['assistantContext']){const h=handle as Handle;if(JSON.stringify(h.input.session.agentSnapshot)!==JSON.stringify(assistant)||h.input.assistantContext?.key!==context?.key){h.input.session.agentSnapshot=assistant;h.input.assistantContext=context;h.promptDirty=true;}}

  private configuredModel() { return this.modelSource(); }

  private async create(input: SessionRuntimeInput, manager: SessionManager): Promise<Handle> {
    const referenceScope = createMessageReferenceScope();
    const searchScope = createServerWebSearchScope();
    const toolSearchScope = createToolSearchScope(this.toolSearchDependencies);
    const loader = loaderFor(input, referenceScope, searchScope, toolSearchScope);
    let context = this.contextFilesSource(input.session.id);
    loader.getAgentsFiles = () => ({agentsFiles:context.documents});
    await loader.reload();
    const configuration = await this.configuredModel();
    const selected = input.selectedModel ?? manager.getBranch().findLast(entry => entry.type === "model_change");
    const model = input.selectedModel ? await resolveConfiguredModel(configuration,input.selectedModel) : await resolveSessionModel(configuration,input.useDefaultModel?undefined:selected&&'provider' in selected?{provider:selected.provider,modelId:selected.modelId}:configuration.model?{provider:configuration.model.provider,modelId:configuration.model.id}:undefined);
    let currentConfiguration=configuration;
    const modelRuntime=new Proxy(configuration.runtime,{get(_target,property){const value=Reflect.get(currentConfiguration.runtime,property,currentConfiguration.runtime);return typeof value==='function'?value.bind(currentConfiguration.runtime):value;}});
    const result = await createPersistentAgentSession({
      cwd: input.workingDirectory,
      sessionManager: manager,
      modelRuntime,
      resourceLoader: loader,
      settingsManager: SettingsManager.inMemory(),
      model,
      tools: ['read', 'bash', 'edit', 'write', ...toolSearchNames],

    });
    result.session.setActiveToolsByName(result.session.getActiveToolNames().filter(name => !toolSearchNames.includes(name)));
    const effective=manager.getBranch().findLast(entry=>entry.type==='model_change');
    if(effective?.provider!==model.provider||effective?.modelId!==model.id)await result.session.setModel(model);
    return {
      session: result.session,
      referenceScope,
      searchScope,
      toolSearchScope,
      manager,
      cwd: input.workingDirectory,
      isProjectSession: input.projectSession !== false,
      input,
      contextFingerprint:JSON.stringify(context),
      refreshContext:()=>{context=this.contextFilesSource(input.session.id);return context;},
      useConfiguration:configuration=>{currentConfiguration=configuration;},
    };
  }

  private async refreshHandle(handle:Handle,selected?:{provider:string;modelId:string},useDefaultModel=false){
    const configuration=await this.configuredModel();
    const branchModel=handle.manager.getBranch().findLast(entry=>entry.type==='model_change');
    const model=selected?await resolveConfiguredModel(configuration,selected):await resolveSessionModel(configuration,!useDefaultModel&&branchModel?{provider:branchModel.provider,modelId:branchModel.modelId}:undefined);
    handle.useConfiguration(configuration);
    const previous=handle.session.model;
    if(previous?.provider===model.provider&&previous.id===model.id){if(JSON.stringify(previous)!==JSON.stringify(model))handle.session.agent.state.model=model;}
    else{await handle.session.setModel(model);persistManager(handle.manager);}
  }

  async refreshModel(handle:object,useDefaultModel=false) {await this.refreshHandle(handle as Handle,undefined,useDefaultModel);}

  async open(input: SessionRuntimeInput) {
    const manager = SessionManager.create(input.workingDirectory);
    const handle = await this.create(input, manager);
    this.handles.set(input.session.id, handle);
    return { handle, nativeRef: nativeRef(handle.session, manager, input.workingDirectory) };
  }

  async initializeProject(input: SessionRuntimeInput, commit: (ref: JsonObject) => JsonObject) {
    const directory = join(process.cwd(), ".data", input.workspace ? "workspace-pi-sessions" : "project-pi-sessions");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, createHash("sha256").update(input.session.id).digest("hex") + ".jsonl");
    const lock = file + ".lock";
    try { mkdirSync(lock, { mode: 0o700 }); } catch { throw new DomainError("SESSION_INITIALIZATION_LOCKED", "Session 初始化中或有残留锁，需人工核对", 409, true); }
    try {
      if (!existsSync(file)) { closeSync(openSync(file, "wx", 0o600)); SessionManager.open(file, directory, input.workingDirectory); }
      const verified = readNativeFile(file, input.workingDirectory);
      if (!verified.endsWithNewline) throw new DomainError("SESSION_TREE_READ_FAILED", "原生历史末尾不完整", 500, true);
      const winner = commit({ kind: "pi", sessionFile: file, sessionId: verified.header.id, cwd: input.workingDirectory });
      return await this.restore({ ...input, session: { ...input.session, nativeRef: winner } });
    } finally { rmdirSync(lock); }
  }

  async restore(input: SessionRuntimeInput) {
    const reference = input.session.nativeRef;
    const sessionFile = reference?.sessionFile;
    if (typeof sessionFile !== "string" || !sessionFile || typeof reference?.sessionId !== "string") throw new DomainError("NO_NATIVE_REF", "Pi 原生 Session 引用无效", 409, true);
    const verified = readNativeFile(sessionFile, input.workingDirectory, reference.sessionId);
    if (!verified.endsWithNewline) throw new DomainError("SESSION_TREE_READ_FAILED", "原生历史末尾不完整", 500, true);
    const manager = SessionManager.open(sessionFile, undefined, input.workingDirectory);
    if(manager.getSessionId()!==reference?.sessionId||manager.getHeader()?.cwd!==input.workingDirectory)throw new DomainError("NO_NATIVE_REF","Pi 原生历史归属不一致",409,true);
    const handle = await this.create(input, manager);
    persistManager(manager);
    this.handles.set(input.session.id, handle);
    return handle;
  }

  validateToolSearch() { toolSearchConfiguration(this.toolSearchDependencies); }

  validateWebSearch(handle: object) { assertServerWebSearch((handle as Handle).session.model); }

  async send(handle: object, message: string, emit: (event: AgentEvent) => void, onAssistantStream?: () => void, references?: import("@/domain/message-references").ReferenceContent, allowProjectWrite = false, webSearch = false, toolSearch = false) {
    const piHandle = handle as Handle;
    await this.refreshHandle(piHandle);
    const previousContext=piHandle.contextFingerprint;
    const context=piHandle.refreshContext();piHandle.contextFingerprint=JSON.stringify(context);
    if(piHandle.promptDirty||previousContext!==piHandle.contextFingerprint){piHandle.session.setActiveToolsByName(piHandle.session.getActiveToolNames());piHandle.promptDirty=false;}
    if(piHandle.deleting)throw new DomainError("REQUEST_ABORTED","会话正在删除",409,true);
    if(webSearch)this.validateWebSearch(handle);
    if(toolSearch)this.validateToolSearch();
    const originalTools = piHandle.input.nativeCodingTools && !piHandle.input.workspace && !allowProjectWrite
      ? piHandle.session.getActiveToolNames() : null;
    const turn: TurnState = {
      publicText: "",
      toolDetails: new Map(),
    };
    let assistantStreamSeen = false,settled=false,settledAborted=false,promptStarted=false;
    let requestFailure: unknown;
    const temporary = new WeakMap<object, string>();
    let currentTemporary: string | null = null;
    const pendingLinks: Promise<void>[] = [];
    const unsubscribe = piHandle.session.subscribe((event) => {
      if(event.type==='agent_settled'){settled=true;settledAborted=event.aborted;}
      const message = "message" in event && event.message && typeof event.message === "object" ? event.message : null;
      if (event.type === "message_start" && message) { currentTemporary = randomUUID(); temporary.set(message, currentTemporary); }
      const temporaryId = message ? temporary.get(message) ?? currentTemporary : currentTemporary;
      emit({ type: "pi_event", piType: event.type, payload: JSON.parse(JSON.stringify(event)), temporaryId });
      if (event.type === "message_end" && message && temporaryId) {
        pendingLinks.push(new Promise<void>(resolve => setImmediate(() => {
          const entry = piHandle.manager.getEntries().find(item => item.type === "message" && item.message === message);
          if (entry) emit({ type: "entry_link", entryId: entry.id, temporaryId });
          resolve();
        })));
        currentTemporary = null;
      }
      if (!assistantStreamSeen && event.type === "message_update") {
        assistantStreamSeen = true;
        onAssistantStream?.();
      }
      mapEvent(event as PiEvent, emit, turn, piHandle.cwd);
    });
    try {
      if(originalTools)piHandle.session.setActiveToolsByName(originalTools.filter(name=>name==='read'));
      piHandle.searchScope.begin(webSearch);
      piHandle.toolSearchScope.begin(toolSearch, piHandle.session);
      const referenceTurnId = piHandle.referenceScope.begin();
      await appendMessageReferences(piHandle.session, references, referenceTurnId);
      if(piHandle.deleting)throw new DomainError("REQUEST_ABORTED","会话正在删除",409,true);
      promptStarted=true;
      piHandle.acceptingSteer=true;
      await piHandle.session.prompt(message, { expandPromptTemplates: false });
      await piHandle.session.waitForIdle();
      if(!settled||!piHandle.session.isIdle)throw new DomainError('REQUEST_UNKNOWN','模型或工具循环终结尚未确认',409,true);
      if(settledAborted)throw new DomainError('REQUEST_ABORTED','请求已停止',409,true);
      const last=piHandle.session.messages.filter(item=>item.role==="assistant").at(-1) as {stopReason?:string;errorMessage?:string} | undefined;
      if(last?.stopReason==="error") { if(/(?:does not|doesn't|do not|not|unsupported|cannot|can't).{0,60}(?:support|accept|process).{0,40}(?:image|vision)|(?:image|vision).{0,60}(?:not supported|unsupported|not allowed)|unsupported.{0,30}(?:image|vision)/i.test(last.errorMessage??""))throw new DomainError('MODEL_IMAGE_UNSUPPORTED','当前模型不支持此图片输入，请切换模型后重试',422,true);if(/context|token.*limit|maximum.*length/i.test(last.errorMessage??""))throw new DomainError("CONTEXT_LIMIT_REACHED","原生上下文已满，请在检查中手动压缩后重新发送",409,true);throw new DomainError("MODEL_REQUEST_FAILED", "模型请求失败，请在Session设置中切换模型或检查供应商配置后，以新请求重新发送",503,true); }
      if(last?.stopReason==="aborted")throw new DomainError("REQUEST_ABORTED","请求已停止",409,true);
    } catch(error) {
      requestFailure=error;
      throw error;
    } finally {
      piHandle.acceptingSteer=false;
      await Promise.allSettled([...(piHandle.steeringWrites??[])]);
      const cleared=piHandle.session.clearQueue();
      if(cleared.steering.length||(piHandle.discardedSteering??0)>0)emit({type:'steering_cleared'});
      piHandle.discardedSteering=0;
      if(promptStarted)await piHandle.session.waitForIdle();
      await Promise.all(pendingLinks);
      piHandle.searchScope.end();
      try { await piHandle.toolSearchScope.end(); }
      finally {
        piHandle.referenceScope.end();
        if(originalTools)piHandle.session.setActiveToolsByName(originalTools);
        unsubscribe();
        persistManager(piHandle.manager);
        // Only certify after every cleanup step and durable transcript write succeeds.
        if(requestFailure instanceof DomainError&&requestFailure.code!=='REQUEST_UNKNOWN'&&settled&&piHandle.session.isIdle){
          Object.assign(requestFailure,{requestSettled:true});
        }
      }
    }
  }

  requestEntries(handle: object) {
    const value=handle as Handle;
    const legacy=value.manager.getEntries().flatMap(entry => entry.type === 'custom' && ['workspace_request','workspace_request_result','workspace_request_acknowledged'].includes(entry.customType) ? [{type:entry.customType,data:entry.data}] : []);
    return [...legacy,...readWorkspaceRequests(this.requestIdentity(value))];
  }

  requestEntry(handle: object, type: string, data: unknown) {
    return appendWorkspaceRequest(this.requestIdentity(handle as Handle),type,data);
  }

  recordRequest(input:SessionRuntimeInput,type:string,data:unknown) {
    const ref=input.session.nativeRef;
    if(!input.workspace||!ref||typeof ref.sessionFile!=='string'||typeof ref.sessionId!=='string')throw new DomainError('NO_NATIVE_REF','工作区请求缺少精确原生身份',409,true);
    readNativeFile(ref.sessionFile,input.workingDirectory,ref.sessionId);
    return appendWorkspaceRequest({sessionId:input.session.id,workspaceId:input.workspace.id,nativeSessionId:ref.sessionId,sessionFile:ref.sessionFile},type,data);
  }

  private requestIdentity(handle: Handle): WorkspaceRequestIdentity {
    const sessionFile=handle.manager.getSessionFile();
    if(!handle.input.workspace||!sessionFile)throw new DomainError('NO_NATIVE_REF','工作区请求记录缺少原生会话身份',409,true);
    return {sessionId:handle.input.session.id,workspaceId:handle.input.workspace.id,nativeSessionId:handle.manager.getSessionId(),sessionFile};
  }

  async readRequestEntries(input: SessionRuntimeInput) {
    const handle=this.handles.get(input.session.id);
    if(handle)return this.requestEntries(handle);
    const ref=input.session.nativeRef;
    if(!ref)return [];
    if(!input.workspace||typeof ref.sessionFile!=='string'||typeof ref.sessionId!=='string')throw new DomainError('NO_NATIVE_REF','工作区原生会话身份无效',409,true);
    const {entries}=readNativeFile(ref.sessionFile,input.workingDirectory,ref.sessionId);
    const legacy=entries.flatMap(entry=>entry.type==='custom'&&['workspace_request','workspace_request_result','workspace_request_acknowledged'].includes(entry.customType)?[{type:entry.customType,data:entry.data}]:[]);
    return [...legacy,...readWorkspaceRequests({sessionId:input.session.id,workspaceId:input.workspace.id,nativeSessionId:ref.sessionId,sessionFile:ref.sessionFile})];
  }

  isBusy(handle: object) { return !(handle as Handle).session.isIdle; }

  subscribe(handle: object, listener: (event: AgentEvent) => void) {
    const pi = handle as Handle;
    return subscribeNativeSession(pi.session, pi.manager, listener);
  }

  steeringQueue(handle: object) { return [...(handle as Handle).session.getSteeringMessages()]; }

  async steer(handle: object, content: string) {
    const value=handle as Handle;
    if(value.deleting)throw new DomainError('SESSION_BUSY','会话正在删除',409,true);
    if(value.session.isCompacting)throw new DomainError('SESSION_BUSY','会话正在压缩',409,true);
    if(!value.acceptingSteer||value.session.isIdle)throw new DomainError('SESSION_NOT_RUNNING','当前没有可纠正的运行请求',409,true);
    const work=value.session.steer(content);
    (value.steeringWrites??=new Set()).add(work);
    try {
      await work;
      if(!value.acceptingSteer||value.deleting||value.session.isIdle){value.discardedSteering=(value.discardedSteering??0)+value.session.clearQueue().steering.length;throw new DomainError('REQUEST_ABORTED','运行已结束，未消费的纠正已清除',409,true);}
    } finally {value.steeringWrites.delete(work);}
  }

  async interrupt(handle: object) {
    const value=handle as Handle;
    value.acceptingSteer=false;
    await value.session.abort();
    await Promise.allSettled([...(value.steeringWrites??[])]);
    value.discardedSteering=(value.discardedSteering??0)+value.session.clearQueue().steering.length;
  }

  async stopForDeletion(handle: object) {
    const value=handle as Handle;
    value.deleting=true;
    try {
      value.session.abortCompaction();
      await this.interrupt(handle);
      await value.session.waitForIdle();
    } catch(error) { value.deleting=false;throw error; }
  }

  async readTree(input: SessionRuntimeInput) {
    const live = this.handles.get(input.session.id);
    if (live) {this.snapshot(input);return structuredClone(snapshotTree(live.manager));}
    const ref = input.session.nativeRef;
    if (typeof ref?.sessionFile !== "string" || typeof ref.sessionId !== "string") throw new DomainError("NO_NATIVE_REF", "Pi 原生历史缺失", 409, true);
    return readTreeFile(ref.sessionFile, input.workingDirectory, ref.sessionId);
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
    return projectTranscriptEntries(manager.getBranch(), { workingDirectory: input.workingDirectory }).map(message => ({ ...message, sessionId: input.session.id, id: message.id || `${input.session.id}` }));
  }

  private manager(input: SessionRuntimeInput): SessionManager | null {
    const handle = this.handles.get(input.session.id);
    if (handle) return handle.manager;
    const file = input.session.nativeRef?.sessionFile;
    return typeof file === "string" ? SessionManager.open(file, undefined, input.workingDirectory) : null;
  }

  private snapshot(input: SessionRuntimeInput) {
    const handle = this.handles.get(input.session.id);
    const ref = input.session.nativeRef;
    if (!ref || typeof ref.sessionFile !== 'string' || typeof ref.sessionId !== 'string') throw new DomainError('NO_NATIVE_REF', '会话没有可读取的原生历史', 409, true);
    const native = readNativeFile(ref.sessionFile, input.workingDirectory, ref.sessionId);
    if (!native.endsWithNewline) throw new DomainError('SESSION_TREE_READ_FAILED', '原生历史末尾不完整', 500, true);
    const entries = handle ? structuredClone(handle.manager.getEntries()) : native.entries.slice(1) as SessionEntry[];
    if (handle) {
      // Pi persists JSON: omitted optional fields and undefined array items must
      // compare the same way as their serialized representation on disk.
      const persisted = JSON.parse(JSON.stringify({ header: handle.manager.getHeader(), entries }));
      if (canonical(persisted) !== canonical({ header: native.header, entries: native.entries.slice(1) })) {
        throw new DomainError('REQUEST_UNKNOWN', '内存树与原生文件不一致，不能生成快照', 409, true);
      }
    }
    const leaf = handle ? handle.manager.getLeafId() : entries.at(-1)?.id ?? null;
    return { header: structuredClone(handle?.manager.getHeader() ?? native.header), entries, leaf, sessionFile: ref.sessionFile, cwd: input.workingDirectory };
  }

  operationEvidence(input: SessionRuntimeInput): JsonObject {
    if (!input.session.nativeRef) return {};
    const snapshot = this.snapshot(input);
    return { nativeRef: structuredClone(input.session.nativeRef), fileSha256: fileDigest(snapshot.sessionFile), leafId: snapshot.leaf, entryIds: snapshot.entries.map(entry => entry.id) };
  }

  preview(session:{nativeRef:JsonObject|null;createdAt:string}):SessionPreview {
    if(!session.nativeRef)return sessionPreview([],session.createdAt);
    try{const ref=session.nativeRef;if(typeof ref.sessionFile!=='string'||typeof ref.cwd!=='string'||typeof ref.sessionId!=='string')throw new Error('invalid identity');const snapshot=readTreeFile(ref.sessionFile,ref.cwd,ref.sessionId);return sessionPreview(snapshot.entries.map(item=>item.entry),session.createdAt);}
    catch{return {lastUserInput:null,lastActivityAt:null,previewUnavailable:true};}
  }

  async models(input: SessionRuntimeInput): Promise<import('@/domain/session-tools').SessionModelView> {
    const configuration = await this.configuredModel();
    const available = new Set((await configuration.runtime.getAvailable()).map(model => model.provider + '\0' + model.id));
    let selected: { provider: string; modelId: string } | null = null;
    let thinkingLevel:SessionThinkingLevel|null=null;
    if (input.session.nativeRef) {
      const snapshot = this.snapshot(input);
      const entry = branchEntries(snapshot.entries, snapshot.leaf).findLast(entry => entry.type === 'model_change');
      if (entry?.type === 'model_change') selected = { provider: entry.provider, modelId: entry.modelId };
      const thinking=branchEntries(snapshot.entries,snapshot.leaf).findLast(entry=>entry.type==='thinking_level_change');
      if(thinking?.type==='thinking_level_change'&&sessionThinkingLevels.includes(thinking.thinkingLevel as SessionThinkingLevel))thinkingLevel=thinking.thinkingLevel as SessionThinkingLevel;
    }
    const live = this.handles.get(input.session.id)?.session.model;
    selected = live ? { provider: live.provider, modelId: live.id } : selected;
    const currentAvailable = !!selected && available.has(selected.provider + '\0' + selected.modelId) && (configuration.models??configuration.runtime.getModels()).some(model=>model.provider===selected!.provider&&model.id===selected!.modelId);
    return {
      thinkingLevel:this.handles.get(input.session.id)?.session.thinkingLevel??thinkingLevel,
      current: selected ? { ...selected, available: currentAvailable, unavailableReason: currentAvailable ? null : 'MODEL_UNAVAILABLE' } : null,
      defaults: configuration.defaults ?? {provider:null,modelId:null},
      models: (configuration.models??configuration.runtime.getModels()).map(model => ({ provider: model.provider, modelId: model.id, name: model.name, reasoning: model.reasoning, thinkingLevels:getSupportedThinkingLevels(model), input: [...model.input], contextWindow: model.contextWindow > 0 ? model.contextWindow : null, maxTokens: model.maxTokens > 0 ? model.maxTokens : null, available: available.has(model.provider + '\0' + model.id), unavailableReason: available.has(model.provider + '\0' + model.id) ? null : 'MODEL_UNAVAILABLE' })),
      sources: configuration.configuration ?? { models: 'native', settings: 'native' },
      canSwitch: true,
      unavailableReason: null,
    };
  }

  async switchModel(input: SessionRuntimeInput, identity: SessionModelSelection) {
    try{const configuration=await this.configuredModel();const target=await resolveConfiguredModel(configuration,identity);if(identity.thinkingLevel!==undefined&&!getSupportedThinkingLevels(target).includes(identity.thinkingLevel))throw new DomainError('INVALID_INPUT','所选模型不支持该思考等级',400,true);}catch(error){if(error instanceof DomainError)Object.assign(error,{noSideEffects:true});throw error;}
    let handle = this.handles.get(input.session.id);
    if (handle && !handle.session.isIdle) throw new DomainError('SESSION_BUSY', '会话正在执行', 409, true);
    if (!handle) handle = await this.restore({ ...input, selectedModel: identity }) as Handle;
    await this.refreshHandle(handle,identity);
    if(identity.thinkingLevel!==undefined){
      if(!handle.session.getAvailableThinkingLevels().includes(identity.thinkingLevel))throw new DomainError('REQUEST_UNKNOWN','模型支持等级在应用期间发生变化，请核对当前设置',409,true);
      handle.session.setThinkingLevel(identity.thinkingLevel);
      if(handle.session.thinkingLevel!==identity.thinkingLevel)throw new DomainError('REQUEST_UNKNOWN','思考等级结果尚未确认',409,true);
    }
    persistManager(handle.manager);
    return this.models(input);
  }

  async fork(input: SessionRuntimeInput, entryId: string, directory: string) {
    const snapshot = this.snapshot(input);
    const digest = fileDigest(snapshot.sessionFile), leaf = this.handles.get(input.session.id)?.manager.getLeafId();
    if (!snapshot.entries.some(entry => entry.id === entryId)) throw new DomainError('NOT_FOUND', '节点不属于该会话树', 404, true);
    const result = prepareFork(snapshot, entryId, directory);
    if (fileDigest(snapshot.sessionFile) !== digest || this.handles.get(input.session.id)?.manager.getLeafId() !== leaf) throw new DomainError('REQUEST_UNKNOWN', '派生期间源会话发生变化', 409, true);
    return result;
  }

  validateForkCandidate(input:SessionRuntimeInput,candidate:JsonObject,entryId:string):JsonObject {
    const source=this.snapshot(input),expected=branchEntries(source.entries,entryId);
    if(typeof candidate.sessionFile!=='string'||typeof candidate.sessionId!=='string'||candidate.cwd!==input.workingDirectory||candidate.sessionFile===source.sessionFile||candidate.sessionId===source.header?.id)throw new DomainError('REQUEST_UNKNOWN','候选原生身份无效',409,true);
    const native=readNativeFile(candidate.sessionFile,input.workingDirectory,candidate.sessionId);
    if(!native.endsWithNewline||native.header.parentSession!==source.sessionFile||canonical(native.entries.slice(1))!==canonical(expected))throw new DomainError('REQUEST_UNKNOWN','候选内容与源节点路径不一致',409,true);
    const reopened=SessionManager.open(candidate.sessionFile);
    if(reopened.getLeafId()!==entryId||canonical(reopened.getBranch())!==canonical(expected))throw new DomainError('REQUEST_UNKNOWN','候选无法恢复精确分支',409,true);
    return {fileSha256:fileDigest(candidate.sessionFile),entryIds:expected.map(entry=>entry.id),sourcePathSha256:hash(canonical(expected))};
  }

  async export(input: SessionRuntimeInput, format: 'html'|'jsonl', scope: 'tree'|'branch') {
    const snapshot = this.snapshot(input);
    const entries = scope === 'tree' ? snapshot.entries : branchEntries(snapshot.entries, snapshot.leaf);
    return renderSessionExport(snapshot.header!, entries, format, input.session.id + ' · ' + scope);
  }

  async inspect(input: SessionRuntimeInput): Promise<NativeContextInspection> {
    if (!input.session.nativeRef) return emptyInspection("Session 尚未启动");
    const handle = this.handles.get(input.session.id);
    if (!handle) return emptyInspection("会话尚未连接，暂无实时用量");
    const branch=handle.manager.getBranch();
    const usage=handle.session.getContextUsage();
    const tokens=usage?.tokens ?? null;
    const window=handle.session.model?.contextWindow && handle.session.model.contextWindow > 0 ? handle.session.model.contextWindow : null;
    const result=emptyInspection("暂无可靠用量");
    result.runtimeReady=true;
    result.autoCompactionEnabled=handle.session.autoCompactionEnabled;
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
    await this.refreshHandle(handle as Handle);
    if((handle as Handle).deleting)throw new DomainError("REQUEST_ABORTED","会话正在删除",409,true);
    const pi = (handle as Handle).session;
    if (!pi.isIdle) throw new DomainError("SESSION_BUSY","Session 正在运行",409,true);
    const manager=(handle as Handle).manager,before=new Set(manager.getEntries().filter(entry=>entry.type==='compaction').map(entry=>entry.id));
    let settled=false,aborted=false;
    const unsubscribe=pi.subscribe(event=>{if(event.type==='compaction_end'){settled=true;aborted=event.aborted;}});
    try { await pi.compact();if(!settled||aborted||!pi.isIdle||!manager.getEntries().some(entry=>entry.type==='compaction'&&!before.has(entry.id)))throw new DomainError('REQUEST_UNKNOWN','压缩缺少可靠终结或新增原生结果',409,true);persistManager(manager); }
    catch(error) {if(settled&&aborted&&pi.isIdle){persistManager(manager);throw new DomainError('REQUEST_ABORTED','压缩已取消',409,true);}const message=error instanceof Error?error.message:"";if(/Nothing to compact|Already compacted/i.test(message))throw new DomainError("NOTHING_TO_COMPACT","原生会话较短或已经压缩，无需压缩",409,true);throw error; }
    finally{unsubscribe();}
  }

  cancelCompaction(handle:object) { (handle as Handle).session.abortCompaction(); }

  async close(handle: object) {
    const piHandle = handle as Handle;
    piHandle.acceptingSteer=false;
    await Promise.allSettled([...(piHandle.steeringWrites??[])]);
    piHandle.session.clearQueue();
    try { piHandle.session.dispose(); }
    catch(error) { piHandle.deleting=false;throw error; }
    for (const [sessionId, value] of this.handles) {
      if (value === piHandle) this.handles.delete(sessionId);
    }
  }

  getHandle(sessionId: string, input?: SessionRuntimeInput) {
    const handle = this.handles.get(sessionId);
    if (!input) return handle;
    if(handle&&handle.input.workingDirectory===input.workingDirectory&&handle.input.nativeCodingTools===input.nativeCodingTools&&handle.input.allowProjectRead===input.allowProjectRead&&handle.input.allowProjectWrite===input.allowProjectWrite){
      const changed=handle.input.assistantContext?.key!==input.assistantContext?.key||!sameRuntimeConfiguration(handle.input,input);
      if(changed){if(!handle.session.isIdle)throw new DomainError('SESSION_BUSY','当前不能更新助手配置',409,true);Object.assign(handle.input,input);handle.promptDirty=true;}
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

export const piSessionRuntime = new PiSessionRuntime(undefined, {}, id => ({documents:sessionContextFiles.documents(id)}));
