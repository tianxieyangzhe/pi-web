import {sessionMemorySummaryPrompt,prepareSessionMemorySummaryInput} from "./session-memory-summary-prompt";
import type {PiContextPort} from "@/application/ports/pi-context";
import type {
  ActivityEvent,
  AgentEvent,
  Agent,
  JsonObject,
  Session,
} from "@/domain/models";
import { isAbsolute, relative, resolve, sep } from "node:path";
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

type Handle = {
  session: PiAgentSession;
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
  round: number;
  publicText: string;
  analysisDetails: string[];
  toolDetails: Map<string, string | undefined>;
  showActionSummary: boolean;
  textMode: "prefix" | "summary" | "response";
  pendingText: string;
  summaryText: string;
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

function visibleToolLabel(toolName: string): string {
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

function safeToolDetail(toolName: string, args: unknown, workingDirectory: string): string | undefined {
  if (!["project_read", "project_list", "project_edit", "project_write"].includes(toolName)) return undefined;
  if (!args || typeof args !== "object") return undefined;
  if (!("path" in args) || typeof args.path !== "string") {
    return toolName === "project_list" ? "目标：项目根目录" : undefined;
  }

  const target = resolve(workingDirectory, args.path);
  const relativePath = relative(workingDirectory, target);
  if (isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${sep}`)) return undefined;
  const segments = relativePath.split(sep).filter(Boolean);
  const sensitiveSegment = /^(?:\.env(?:\.|$)|\.git$|\.ssh$|\.aws$|\.codex$|\.npmrc$|\.pypirc$|credentials?\.|id_(?:rsa|dsa|ecdsa|ed25519)|node_modules$)/i;
  if (segments.some((segment) => sensitiveSegment.test(segment))) return undefined;
  return `目标：${segments.join("/") || "项目根目录"}`;
}

function safePublicSummary(value: string, workingDirectory: string): string {
  return value
    .replaceAll(workingDirectory, "项目根目录")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._~+/-]+=*)\b/gi, "[已隐藏敏感信息]")
    .replace(/\b((?:OPENAI|API|ACCESS|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)?\s*[:=]\s*)[^\s,;]+/gi, "$1[已隐藏]")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, 600);
}

function extractPublicSummary(value: string): { summary?: string; text: string } {
  const openIndex = value.indexOf(PUBLIC_SUMMARY_OPEN);
  if (openIndex < 0) return { text: value };
  const closeIndex = value.indexOf(PUBLIC_SUMMARY_CLOSE, openIndex + PUBLIC_SUMMARY_OPEN.length);
  if (closeIndex < 0) return { text: value.slice(0, openIndex) };
  return {
    summary: value.slice(openIndex + PUBLIC_SUMMARY_OPEN.length, closeIndex),
    text: value.slice(0, openIndex) + value.slice(closeIndex + PUBLIC_SUMMARY_CLOSE.length),
  };
}

function loaderFor(input: SessionRuntimeInput): DefaultResourceLoader {
  const agent = input.session.agentSnapshot as Agent | null;
  const extension = agent?.extension;
  const loader = new DefaultResourceLoader({
    noExtensions: true,
    cwd: input.workingDirectory,
    agentDir: getAgentDir(),
    additionalSkillPaths: extension?.skillPaths ?? [],
    appendSystemPrompt: [
      ...(extension?.instruction ? [extension.instruction] : []),
      ...(input.projectSession !== false ? [
        `At the start of every model turn, emit exactly one concise, high-level, user-facing summary inside ${PUBLIC_SUMMARY_OPEN}...${PUBLIC_SUMMARY_CLOSE}, before any answer text or tool call. Describe the request objective and your high-level approach or next action in 1-3 short sentences. This is an explicitly public summary, not private chain-of-thought. Never reveal hidden reasoning, detailed deliberation, speculative internal notes, secrets, raw tool arguments or results, or absolute paths. After the closing marker, continue with the normal answer.`,
        "Before each tool call, provide one concise user-facing execution note stating the operation, the concrete project-relative target when known, and why or what result you expect. Keep it factual and specific. This is progress text, not private chain-of-thought; never reveal hidden reasoning, detailed deliberation, tool arguments, secrets, or absolute paths.",
      ] : []),
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
  const recordSummary = (value: string) => {
    const detail = safePublicSummary(value, workingDirectory);
    if (!detail || turn.analysisDetails.includes(detail) || turn.analysisDetails.length >= 8) return;
    turn.analysisDetails.push(detail);
    emit({
      type: "activity",
      id: `model-round-${turn.round}`,
      round: turn.round,
      kind: "thinking",
      state: "completed",
      summary: `Pi 第 ${turn.round} 轮模型公开摘要`,
      detail: turn.analysisDetails.join("\n"),
    });
  };
  const emitResponseText = (text: string) => {
    if (!text) return;
    turn.publicText += text;
    emit({ type: "message_delta", text });
  };
  const consumeText = (text: string) => {
    if (!text) return;
    if (!turn.showActionSummary) {
      emitResponseText(text);
      return;
    }
    if (turn.textMode === "response") {
      emitResponseText(text);
      return;
    }
    if (turn.textMode === "prefix") {
      turn.pendingText += text;
      const trimmed = turn.pendingText.trimStart();
      if (trimmed.startsWith(PUBLIC_SUMMARY_OPEN)) {
        turn.pendingText = "";
        turn.textMode = "summary";
        const remainder = trimmed.slice(PUBLIC_SUMMARY_OPEN.length);
        consumeText(remainder);
        return;
      }
      if (trimmed.length < PUBLIC_SUMMARY_OPEN.length && PUBLIC_SUMMARY_OPEN.startsWith(trimmed)) return;
      turn.textMode = "response";
      const pendingText = turn.pendingText;
      turn.pendingText = "";
      emitResponseText(pendingText);
      return;
    }

    turn.summaryText += text;
    const closeIndex = turn.summaryText.indexOf(PUBLIC_SUMMARY_CLOSE);
    if (closeIndex < 0) return;
    const summary = turn.summaryText.slice(0, closeIndex);
    const response = turn.summaryText.slice(closeIndex + PUBLIC_SUMMARY_CLOSE.length);
    turn.summaryText = "";
    turn.textMode = "response";
    recordSummary(summary);
    emitResponseText(response);
  };
  const finishText = () => {
    if (turn.textMode === "prefix" && turn.pendingText) {
      emitResponseText(turn.pendingText);
      turn.pendingText = "";
      turn.textMode = "response";
      return;
    }
    if (turn.textMode === "summary") {
      recordSummary(turn.summaryText);
      turn.summaryText = "";
      turn.textMode = "response";
    }
  };
  if (event.type === "turn_start") {
    turn.round += 1;
    turn.publicText = "";
    turn.analysisDetails = [];
    turn.toolDetails.clear();
    turn.textMode = "prefix";
    turn.pendingText = "";
    turn.summaryText = "";
    emit({
      type: "activity",
      id: `model-round-${turn.round}`,
      round: turn.round,
      kind: "thinking",
      state: "running",
      summary: `Pi 第 ${turn.round} 轮模型调用已开始`,
    });
    return;
  }
  if (event.type === "message_update" && modelEvent?.type === "thinking_start") {
    emit({ type: "activity", id: `model-round-${turn.round}`, round: turn.round, kind: "thinking", state: "running", summary: `Pi 第 ${turn.round} 轮正在生成分析阶段` });
    return;
  }
  if (event.type === "message_update" && modelEvent?.type === "thinking_end") {
    emit({ type: "activity", id: `model-round-${turn.round}`, round: turn.round, kind: "thinking", state: "completed", summary: `Pi 第 ${turn.round} 轮分析阶段已完成` });
    return;
  }
  if (event.type === "message_update" && modelEvent?.type === "text_delta") {
    consumeText(modelEvent.delta ?? "");
    return;
  }
  if (event.type === "message_update" && modelEvent?.type === "thinking_delta") {
    emit({ type: "activity", id: `model-round-${turn.round}`, round: turn.round, kind: "thinking", state: "running", summary: `Pi 第 ${turn.round} 轮正在生成分析阶段` });
    return;
  }
  if (event.type === "message_update" && modelEvent?.type === "toolcall_end") {
    finishText();
    const toolCall = modelEvent.toolCall;
    if (toolCall?.id) {
      if (turn.showActionSummary) recordSummary(turn.publicText);
      turn.toolDetails.set(toolCall.id, safeToolDetail(toolCall.name ?? "", toolCall.arguments, workingDirectory));
      if (turn.showActionSummary) {
        emit({
          type: "activity",
          id: `model-round-${turn.round}`,
          round: turn.round,
          kind: "thinking",
          state: "completed",
          summary: `Pi 第 ${turn.round} 轮模型公开摘要`,
          ...(turn.analysisDetails.length ? { detail: turn.analysisDetails.join("\n") } : {}),
        });
        if (turn.publicText) emit({ type: "response_reset" });
      }
      turn.publicText = "";
      emit({
        type: "activity",
        id: `tool-${toolCall.id}`,
        round: turn.round,
        kind: "tool",
        state: "running",
        summary: `准备执行：${visibleToolLabel(toolCall.name ?? "")}`,
        ...(turn.toolDetails.get(toolCall.id) ? { detail: turn.toolDetails.get(toolCall.id) } : {}),
      });
    }
    return;
  }
  if (event.type === "tool_execution_start") {
    emit({
      type: "activity",
      id: `tool-${event.toolCallId ?? event.toolName ?? "unknown"}`,
      round: turn.round,
      kind: "tool",
      state: "running",
      summary: `正在执行：${visibleToolLabel(event.toolName ?? "")}`,
      ...(turn.toolDetails.get(event.toolCallId ?? "") ? { detail: turn.toolDetails.get(event.toolCallId ?? "") } : {}),
    });
    return;
  }
  if (event.type === "tool_execution_update") {
    emit({
      type: "activity",
      id: `tool-${event.toolCallId ?? event.toolName ?? "unknown"}`,
      round: turn.round,
      kind: "tool",
      state: "running",
      summary: `正在执行：${visibleToolLabel(event.toolName ?? "")}`,
      ...(turn.toolDetails.get(event.toolCallId ?? "") ? { detail: turn.toolDetails.get(event.toolCallId ?? "") } : {}),
    });
    return;
  }
  if (event.type === "tool_execution_end") {
    emit({
      type: "activity",
      id: `tool-${event.toolCallId ?? event.toolName ?? "unknown"}`,
      round: turn.round,
      kind: "tool",
      state: event.isError ? "error" : "completed",
      summary: `${event.isError ? "执行失败" : "已完成"}：${visibleToolLabel(event.toolName ?? "")}`,
      ...(turn.toolDetails.get(event.toolCallId ?? "") ? { detail: turn.toolDetails.get(event.toolCallId ?? "") } : {}),
    });
    return;
  }
  if (event.type === "compaction_start") {
    emit({
      type: "activity",
      id: `context-compaction-${turn.round}`,
      round: turn.round,
      kind: "context",
      state: "running",
      summary: "正在整理上下文",
    });
    return;
  }
  if (event.type === "compaction_end") {
    emit({
      type: "activity",
      id: `context-compaction-${turn.round}`,
      round: turn.round,
      kind: "context",
      state: "completed",
      summary: "上下文整理完成",
    });
  }
  if (event.type === "turn_end" || event.type === "agent_end") {
    finishText();
    if (turn.round > 0) {
      emit({
        type: "activity",
        id: `model-round-${turn.round}`,
        round: turn.round,
        kind: "thinking",
        state: "completed",
        summary: turn.analysisDetails.length
          ? `Pi 第 ${turn.round} 轮模型公开摘要`
          : `Pi 第 ${turn.round} 轮未提供模型公开摘要`,
        ...(turn.analysisDetails.length ? { detail: turn.analysisDetails.join("\n") } : {}),
      });
    }
  }
}

class PiSessionRuntime implements PiRuntimePort, PiContextPort {
  private readonly handles = new Map<string, Handle>();
  private modelRuntime: ReturnType<typeof createOpenAIModelRuntime> | undefined;

  private configuredModel() {
    this.modelRuntime ??= createOpenAIModelRuntime();
    return this.modelRuntime;
  }

  private async create(input: SessionRuntimeInput, manager: SessionManager): Promise<Handle> {
    const loader = loaderFor(input);
    await loader.reload();
    const { runtime: modelRuntime, model } = await this.configuredModel();
    const agent = input.session.agentSnapshot?.extension;
    const customTools = [
      ...(await createPiProjectTools(input)),
    ];
    const result = await createAgentSession({
      cwd: input.workingDirectory,
      sessionManager: manager,
      modelRuntime,
      resourceLoader: loader,
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
      model: agent?.thinkingLevel && agent.thinkingLevel !== "off"
        ? { ...model, reasoning: true }
        : model,
      noTools: customTools.length ? "builtin" : "all",
      ...(customTools.length ? { customTools } : {}),
      ...(agent?.thinkingLevel ? { thinkingLevel: agent.thinkingLevel } : {}),
    });
    return {
      session: result.session,
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
    const manager = SessionManager.open(sessionFile, undefined, input.workingDirectory);
    const handle = await this.create(input, manager);
    this.handles.set(input.session.id, handle);
    return handle;
  }

  async send(handle: object, message: string, emit: (event: AgentEvent) => void) {
    const piHandle = handle as Handle;
    const turn: TurnState = {
      round: 0,
      publicText: "",
      analysisDetails: [],
      toolDetails: new Map(),
      showActionSummary: piHandle.isProjectSession,
      textMode: "prefix",
      pendingText: "",
      summaryText: "",
    };
    const unsubscribe = piHandle.session.subscribe((event) =>
      mapEvent(event as PiEvent, emit, turn, piHandle.cwd),
    );
    try {
      piHandle.session.setAutoCompactionEnabled(false);
      await piHandle.session.prompt(message, { expandPromptTemplates: false });
      const last=piHandle.session.messages.filter(item=>item.role==="assistant").at(-1) as {stopReason?:string;errorMessage?:string} | undefined;
      if(last?.stopReason==="error") { if(/context|token.*limit|maximum.*length/i.test(last.errorMessage??""))throw new DomainError("CONTEXT_LIMIT_REACHED","原生上下文已满，请在检查中手动压缩后重新发送",409,true);throw new DomainError("RUNTIME_ERROR","模型请求失败，请检查配置或恢复状态",503,true); }
      if(last?.stopReason==="aborted")throw new DomainError("REQUEST_ABORTED","请求已停止",409,true);
    } finally {
      unsubscribe();
    }
  }

  async interrupt(handle: object) {
    await (handle as Handle).session.abort();
  }

  async readMessages(input: SessionRuntimeInput) {
    let manager: SessionManager;
    if (input.session.nativeRef?.sessionFile && typeof input.session.nativeRef.sessionFile === "string") {
      manager = SessionManager.open(input.session.nativeRef.sessionFile, undefined, input.workingDirectory);
    } else {
      manager = SessionManager.create(input.workingDirectory);
    }
    const entries = manager.getBranch();
    const toolResults = new Map<string, boolean>();
    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const message = entry.message as { role?: string; toolCallId?: unknown; isError?: unknown };
      if (message.role === "toolResult" && typeof message.toolCallId === "string") {
        toolResults.set(message.toolCallId, message.isError === true);
      }
    }
    const result: Array<{
      id: string;
      sessionId: string;
      role: "user" | "assistant";
      content: string;
      createdAt: string;
      activities?: ActivityEvent[];
    }> = [];
    let pendingActivities: ActivityEvent[] = [];
    let round = 0;
    const appendPendingActivities = (id: string, createdAt: string) => {
      if (!pendingActivities.length) return;
      result.push({
        id,
        sessionId: input.session.id,
        role: "assistant",
        content: "",
        createdAt,
        activities: pendingActivities,
      });
      pendingActivities = [];
    };
    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const msg = entry.message as { role?: string; content?: unknown };
      if (msg.role === "user") {
        const text = textContent(msg.content);
        if (!text) continue;
        appendPendingActivities(`${entry.id}:unfinished-activity`, entry.timestamp);
        round = 0;
        result.push({
          id: entry.id || `${input.session.id}-${result.length}`,
          sessionId: input.session.id,
          role: "user",
          content: text,
          createdAt: entry.timestamp,
        });
        continue;
      }
      if (msg.role !== "assistant") continue;
      round += 1;
      const blocks = Array.isArray(msg.content)
        ? msg.content.filter((block): block is Record<string, unknown> => Boolean(block) && typeof block === "object")
        : [];
      const toolCalls = blocks.filter((block) => block.type === "toolCall");
      const parsedText = input.projectSession !== false
        ? extractPublicSummary(textContent(msg.content))
        : { text: textContent(msg.content) };
      const summaryDetails = input.projectSession !== false && parsedText.summary
        ? [safePublicSummary(parsedText.summary, input.workingDirectory)]
        : [];
      const executionNote = input.projectSession !== false && toolCalls.length
        ? safePublicSummary(parsedText.text, input.workingDirectory)
        : "";
      if (executionNote && !summaryDetails.includes(executionNote)) summaryDetails.push(executionNote);
      pendingActivities.push({
        type: "activity",
        id: `history:${entry.id}:analysis`,
        round,
        kind: "thinking",
        state: "completed",
        summary: summaryDetails.some(Boolean)
          ? `Pi 第 ${round} 轮模型公开摘要`
          : `Pi 第 ${round} 轮未提供模型公开摘要`,
        ...(summaryDetails.some(Boolean) ? { detail: summaryDetails.filter(Boolean).join("\n") } : {}),
      });
      for (const block of toolCalls) {
        if (block.type !== "toolCall" || typeof block.id !== "string") continue;
        const toolName = typeof block.name === "string" ? block.name : "";
        const hasResult = toolResults.has(block.id);
        const failed = toolResults.get(block.id) === true;
        pendingActivities.push({
          type: "activity",
          id: `history:${entry.id}:${block.id}`,
          round,
          kind: "tool",
          state: !hasResult || failed ? "error" : "completed",
          summary: `${!hasResult ? "执行未完成" : failed ? "执行失败" : "已完成"}：${visibleToolLabel(toolName)}`,
          ...(() => {
            const detail = safeToolDetail(toolName, block.arguments, input.workingDirectory);
            return detail ? { detail } : {};
          })(),
        });
      }
      const text = parsedText.text;
      if (!text || toolCalls.length) continue;
      result.push({
        id: entry.id || `${input.session.id}-${result.length}`,
        sessionId: input.session.id,
        role: "assistant",
        content: text,
        createdAt: entry.timestamp,
        ...(pendingActivities.length ? { activities: pendingActivities } : {}),
      });
      pendingActivities = [];
    }
    appendPendingActivities(`${input.session.id}-unfinished-activity`, entries.at(-1)?.timestamp ?? new Date().toISOString());
    return result;
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
      handle && handle.cwd === input.workingDirectory && handle.input.allowProjectWrite === input.allowProjectWrite
    ) {
      handle.session.setAutoCompactionEnabled(false);
      return handle;
    }
    if (handle) {
      handle.session.dispose();
      this.handles.delete(sessionId);
    }
    return undefined;
  }
}

export const piSessionRuntime = new PiSessionRuntime();
