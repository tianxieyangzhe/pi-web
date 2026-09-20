import type {
  AgentEvent,
  Agent,
  JsonObject,
  Session,
} from "@/domain/models";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession as PiAgentSession } from "@earendil-works/pi-coding-agent";
import type { PiRuntimePort, SessionRuntimeInput } from "@/application/ports/pi-runtime";
import { createPiProjectTools } from "@/infrastructure/projects/pi-project-tools.server";
import { createDelegateSessionTool, proposeRoomContentTool } from "@/infrastructure/pi/pi-room-content-tool.server";
import { createOpenAIModelRuntime } from "@/infrastructure/pi/openai-model-config.server";
import { redactForDisplay } from "@/infrastructure/security/redaction.server";

type Handle = {
  session: PiAgentSession;
  manager: SessionManager;
  cwd: string;
  configurationRevision: number;
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
  };
  delta?: string;
  result?: unknown;
  args?: unknown;
  partialResult?: unknown;
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

function thinkingContent(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts = value
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const item = part as { type?: string; text?: string; thinking?: string };
      return item.type === "thinking" ? item.thinking ?? "" : "";
    })
    .filter((t) => t);
  return parts.length > 0 ? parts.join("") : undefined;
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

function loaderFor(input: SessionRuntimeInput): DefaultResourceLoader {
  const agent = input.session.agentSnapshot as Agent | null;
  const extension = agent?.extension;
  const loader = new DefaultResourceLoader({
    cwd: input.workingDirectory,
    agentDir: getAgentDir(),
    additionalSkillPaths: extension?.skillPaths ?? [],
    appendSystemPrompt: [
      ...(extension?.instruction ? [extension.instruction] : []),
      ...(input.referenceDirectories.length
        ? [
            `可参考但默认不可写的其他项目目录：\n${input.referenceDirectories.join("\n")}`,
          ]
        : []),
    ],
  });
  return loader;
}

function mapEvent(
  event: PiEvent,
  emit: (event: AgentEvent) => void,
  thinkingAccumulator: Map<string, string>,
): void {
  const modelEvent = event.assistantMessageEvent;
  if (event.type === "message_update" && modelEvent?.type === "text_delta") {
    emit({ type: "message_delta", text: modelEvent.delta ?? "" });
    return;
  }
  if (event.type === "message_update" && modelEvent?.type === "thinking_delta") {
    const thinkingId = `thinking-${modelEvent.contentIndex ?? 0}`;
    const previous = thinkingAccumulator.get(thinkingId) ?? "";
    thinkingAccumulator.set(thinkingId, previous + (modelEvent.delta ?? ""));
    emit({
      type: "activity",
      id: thinkingId,
      kind: "thinking",
      state: "running",
      summary: "思考过程",
      detail: redactForDisplay(thinkingAccumulator.get(thinkingId)!),
    });
    return;
  }
  if (event.type === "tool_execution_start") {
    if (event.toolName === "propose_room_content" && event.args && typeof event.args === "object") {
      const candidate = event.args as {
        kind?: string;
        outputKind?: string;
        title?: string;
        body?: string;
      };
      if (
        (candidate.kind === "goal" || candidate.kind === "direction" || candidate.kind === "output") &&
        typeof candidate.title === "string" &&
        typeof candidate.body === "string" &&
        (candidate.kind !== "output" || ["note", "decision", "plan", "delivery", "summary"].includes(candidate.outputKind ?? ""))
      ) {
        emit({
          type: "room_content_candidate",
          candidate: {
            kind: candidate.kind,
            ...(candidate.kind === "output" && candidate.outputKind
              ? { outputKind: candidate.outputKind as "note" | "decision" | "plan" | "delivery" | "summary" }
              : {}),
            title: candidate.title,
            body: candidate.body,
          },
        });
      }
    }
    emit({
      type: "activity",
      id: `tool-${event.toolCallId ?? event.toolName ?? "unknown"}`,
      kind: "tool",
      state: "running",
      summary: `正在执行 ${event.toolName ?? "工具"}`,
      detail: redactForDisplay(event.args),
    });
    return;
  }
  if (event.type === "tool_execution_update") {
    const updateDetail = event.partialResult ?? event.result ?? event.delta;
    emit({
      type: "activity",
      id: `tool-${event.toolCallId ?? event.toolName ?? "unknown"}`,
      kind: "tool",
      state: updateDetail ? "completed" : "running",
      summary: updateDetail ? `已完成：${event.toolName ?? "工具"}` : `正在执行 ${event.toolName ?? "工具"}`,
      detail: updateDetail ? redactForDisplay(updateDetail) : undefined,
    });
    if (updateDetail) {
      emit({
        type: "tool_result",
        toolName: event.toolName ?? "工具",
        result: updateDetail,
      });
    }
    return;
  }
  if (event.type === "tool_execution_end") {
    emit({
      type: "activity",
      id: `tool-${event.toolCallId ?? event.toolName ?? "unknown"}`,
      kind: "tool",
      state: event.isError ? "error" : "completed",
      summary: `${event.isError ? "执行失败" : "已完成"}：${event.toolName ?? "工具"}`,
      detail: redactForDisplay(event.result),
    });
    emit({
      type: "tool_result",
      toolName: event.toolName ?? "工具",
      result: redactForDisplay(event.result),
    });
    return;
  }
  if (event.type === "compaction_start") {
    emit({
      type: "activity",
      id: "context-compaction",
      kind: "context",
      state: "running",
      summary: "正在整理上下文",
    });
    return;
  }
  if (event.type === "compaction_end") {
    emit({
      type: "activity",
      id: "context-compaction",
      kind: "context",
      state: "completed",
      summary: "上下文整理完成",
    });
  }
}

class PiSessionRuntime implements PiRuntimePort {
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
      proposeRoomContentTool,
      ...(input.delegateSession ? [createDelegateSessionTool(input.delegateSession)] : []),
      ...(await createPiProjectTools(input)),
    ];
    const result = await createAgentSession({
      cwd: input.workingDirectory,
      sessionManager: manager,
      modelRuntime,
      resourceLoader: loader,
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
      configurationRevision: input.session.configurationRevision,
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
    const thinkingAccumulator = new Map<string, string>();
    const unsubscribe = piHandle.session.subscribe((event) =>
      mapEvent(event as PiEvent, emit, thinkingAccumulator),
    );
    try {
      await piHandle.session.prompt(message);
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
    const entries = manager.getEntries();
    const toolBuffer: Array<{ tool: string; detail: string }> = [];
    const result: Array<{
      id: string;
      sessionId: string;
      role: "user" | "assistant";
      content: string;
      thinking?: string;
      toolResults?: string;
      createdAt: string;
    }> = [];
    let assistantIndex = 0;
    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const msg = entry.message as { role?: string; content?: unknown; tool_calls?: unknown };
      if (msg.role === "user" || msg.role === "assistant") {
        const text = textContent(msg.content);
        const thinking = thinkingContent(msg.content);
        if (!text) continue;
        const role = msg.role as "user" | "assistant";
        const toolResults = toolBuffer.length > 0
          ? JSON.stringify(toolBuffer)
          : undefined;
        toolBuffer.length = 0;
        if (role === "assistant") assistantIndex = result.length;
        result.push({
          id: entry.id || `${input.session.id}-${result.length}`,
          sessionId: input.session.id,
          role,
          content: text,
          ...(thinking ? { thinking } : {}),
          ...(toolResults ? { toolResults } : {}),
          createdAt: entry.timestamp,
        });
      } else if (msg.role === "bash_execution") {
        const bashContent = (Array.isArray(msg.content) ? msg.content : [])
          .filter((p: unknown): p is { type?: string; cmd?: string; output?: string; exitCode?: number } =>
            typeof p === "object" && p !== null
          );
        const cmd = bashContent.map((p: { cmd?: string }) => p.cmd ?? "").filter(Boolean).join("\n");
        const output = bashContent.map((p: { output?: string }) => p.output ?? "").filter(Boolean).join("\n");
        const detail = cmd ? `$ ${cmd}\n${output ? output : ""}` : output || textContent(msg.content);
        if (detail) toolBuffer.push({ tool: "bash", detail });
      } else if (msg.role === "tool" || msg.role === "toolResult") {
        const text = textContent(msg.content);
        if (text) toolBuffer.push({ tool: "工具", detail: text });
      }
    }
    return result;
  }

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
      handle &&
      handle.cwd === input.workingDirectory &&
      handle.configurationRevision === input.session.configurationRevision
    ) {
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
