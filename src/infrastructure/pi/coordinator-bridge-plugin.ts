import { Type } from "typebox";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { DomainError } from "@/domain/errors";
import { coordinatorDiagnostic, coordinatorErrorCode } from "./coordinator-diagnostics";

export type ProjectCallStatus = "accepted" | "working" | "completed" | "aborted" | "unknown";
export type ProjectCallProgress = "not_started" | "processing" | "finished";

export type ProjectCall = {
  id: string;
  conversationId: string;
  projectId: string;
  sessionId: string | null;
  sourceEntryId: string;
  sentContent: string;
  status: ProjectCallStatus;
  startEntryId: string | null;
  endEntryId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectCallAgent = {
  agentId: string;
  revision: number;
  name: string;
  responsibility: string;
  boundary: string;
};

export type ProjectSessionHandle = {
  sessionId: string;
  subscribe(listener: (event: { type: "agent_settled"; aborted: boolean; endEntryId: string | null }) => void): () => void;
  prompt(content: string): Promise<{ startEntryId: string }>;
  steer(content: string): Promise<void>;
  readAssistant(startEntryId: string, endEntryId: string): Promise<string>;
};

export type ProjectCallStore = {
  now(): string;
  nextId(): string;
  get(id: string): ProjectCall | null;
  findDuplicate(input: { conversationId: string; projectId: string; sourceEntryId: string; sentContent: string }): ProjectCall | null;
  list(conversationId: string): ProjectCall[];
  insert(call: ProjectCall): ProjectCall;
  update(id: string, expected: ProjectCallStatus, patch: Partial<ProjectCall>): ProjectCall;
  agent(conversationId: string, projectId: string): ProjectCallAgent | null;
  sessionFor(conversationId: string, projectId: string): Promise<ProjectSessionHandle>;
  notify(callId: string, progress: ProjectCallProgress): void;
};

export type BridgeTool = {
  name: string;
  description: string;
  parameters: ReturnType<typeof Type.Object>;
  execute(args: Record<string, unknown>): Promise<unknown>;
};

const text = Type.String({ minLength: 1 });
const progressByStatus: Record<ProjectCallStatus, ProjectCallProgress> = {
  accepted: "not_started",
  working: "processing",
  completed: "finished",
  aborted: "finished",
  unknown: "finished",
};

export function projectCallProgress(status: ProjectCallStatus): ProjectCallProgress {
  return progressByStatus[status];
}

function required(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new DomainError("INVALID_INPUT", `${field}不能为空`, 400, true);
  return value.trim();
}

function view(call: ProjectCall) {
  return {
    callId: call.id,
    projectId: call.projectId,
    sessionId: call.sessionId,
    status: call.status,
    progress: projectCallProgress(call.status),
    hasResult: call.status === "completed",
  };
}

export function createProjectCallTools(store: ProjectCallStore, conversationId: string, maxParallel: number): BridgeTool[] {
  const active = () => store.list(conversationId).filter(call => call.status === "accepted" || call.status === "working");
  const getOwned = (id: string) => {
    const call = store.get(id);
    if (!call || call.conversationId !== conversationId) throw new DomainError("NOT_FOUND", "项目调用不存在", 404, true);
    return call;
  };
  const start = async (call: ProjectCall) => {
    const startedAt = performance.now();
    const log = (stage: string, extra: { sessionId?: string; status?: string; errorCode?: string } = {}) => coordinatorDiagnostic({ conversationId, callId: call.id, stage, elapsedMs: Math.round(performance.now() - startedAt), ...extra });
    if (call.sessionId || call.status !== "accepted") { log("start_skipped", { status: call.status }); return call; }
    if (active().some(item => item.projectId === call.projectId && item.id !== call.id)) { log("queued_project_busy"); return call; }
    if (active().filter(item => item.status === "working").length >= maxParallel) { log("queued_parallel_limit"); return call; }
    let current = call;
    let stage = "session_handle";
    try {
      log("session_handle_start");
      const session = await store.sessionFor(conversationId, call.projectId);
      log("session_handle_ready", { sessionId: session.sessionId });
      stage = "session_binding";
      current = store.update(call.id, "accepted", { sessionId: session.sessionId, updatedAt: store.now() });
      stage = "project_prompt";
      log("project_prompt_start", { sessionId: session.sessionId });
      const started = await session.prompt(current.sentContent);
      log("project_prompt_returned", { sessionId: session.sessionId });
      stage = "working_update";
      current = store.update(call.id, "accepted", { status: "working", startEntryId: started.startEntryId, updatedAt: store.now() });
      stage = "subscribe";
      session.subscribe(event => {
        const latest = store.get(call.id);
        log("project_settled", { sessionId: session.sessionId, status: event.aborted || !event.endEntryId ? "aborted" : "completed" });
        if (!latest || latest.status !== "working") return;
        if (event.aborted || !event.endEntryId) {
          store.update(call.id, "working", { status: "aborted", updatedAt: store.now() });
          store.notify(call.id, "finished");
          return;
        }
        store.update(call.id, "working", { status: "completed", endEntryId: event.endEntryId, updatedAt: store.now() });
        store.notify(call.id, "finished");
        void drain(call.projectId);
      });
      log("subscribed", { sessionId: session.sessionId });
      store.notify(call.id, "processing");
      return current;
    } catch (error) {
      log(`${stage}_failed`, { errorCode: coordinatorErrorCode(error) });
      if (current.status === "accepted") store.update(call.id, "accepted", { status: "unknown", updatedAt: store.now() });
      const result = store.get(call.id) ?? current;
      log("start_failed_result", { status: result.status });
      return result;
    }
  };
  const drain = async (projectId: string) => {
    const next = store.list(conversationId)
      .filter(call => call.projectId === projectId && call.status === "accepted")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (next) await start(next);
  };

  return [
    {
      name: "bot_read_project_agent",
      description: "读取当前协调会话中一个项目 Agent 的功能、职责和边界。不读取项目文件。",
      parameters: Type.Object({ projectId: text }),
      async execute(args) {
        const projectId = required(args.projectId, "projectId");
        const agent = store.agent(conversationId, projectId);
        if (!agent) throw new DomainError("NOT_FOUND", "项目 Agent 不存在", 404, true);
        return agent;
      },
    },
    {
      name: "bot_start_project_call",
      description: "保存并启动一次项目调用。立即返回，不等待项目完成。",
      parameters: Type.Object({ projectId: text, sourceEntryId: text, sentContent: text }),
      async execute(args) {
        const projectId = required(args.projectId, "projectId");
        const sourceEntryId = required(args.sourceEntryId, "sourceEntryId");
        const sentContent = required(args.sentContent, "sentContent");
        if (!store.agent(conversationId, projectId)) throw new DomainError("NOT_FOUND", "项目不在当前协调会话范围", 404, true);
        const existing = store.findDuplicate({ conversationId, projectId, sourceEntryId, sentContent });
        if (existing) { coordinatorDiagnostic({ conversationId, callId: existing.id, stage: "duplicate", status: existing.status }); return view(existing); }
        const saved = store.insert({
          id: store.nextId(), conversationId, projectId, sessionId: null, sourceEntryId, sentContent,
          status: "accepted", startEntryId: null, endEntryId: null, createdAt: store.now(), updatedAt: store.now(),
        });
        coordinatorDiagnostic({ conversationId, callId: saved.id, stage: "call_saved", status: saved.status });
        return view(await start(saved));
      },
    },
    {
      name: "bot_get_project_call",
      description: "查询项目调用的明确状态和有界进度。不返回项目输出。",
      parameters: Type.Object({ callId: text }),
      async execute(args) {
        return view(getOwned(required(args.callId, "callId")));
      },
    },
    {
      name: "bot_read_project_result",
      description: "仅在项目调用 completed 后，按 transcript 边界读取该次 assistant 原文。",
      parameters: Type.Object({ callId: text }),
      async execute(args) {
        const call = getOwned(required(args.callId, "callId"));
        if (call.status !== "completed" || !call.sessionId || !call.startEntryId || !call.endEntryId) {
          throw new DomainError("INVALID_STATE", "项目调用尚未完成", 409, true);
        }
        const session = await store.sessionFor(conversationId, call.projectId);
        return { callId: call.id, content: await session.readAssistant(call.startEntryId, call.endEntryId) };
      },
    },
    {
      name: "bot_steer_project_call",
      description: "只修正仍在 working 的原项目调用，不创建新调用。",
      parameters: Type.Object({ callId: text, content: text }),
      async execute(args) {
        const call = getOwned(required(args.callId, "callId"));
        const content = required(args.content, "content");
        if (call.status !== "working" || !call.sessionId) return view(call);
        const session = await store.sessionFor(conversationId, call.projectId);
        await session.steer(content);
        return { ...view(store.get(call.id) ?? call), steered: true };
      },
    },
    {
      name: "bot_abandon_project_call",
      description: "只放弃 unknown 项目调用。不调用 Pi，不读取项目输出。",
      parameters: Type.Object({ callId: text }),
      async execute(args) {
        const call = getOwned(required(args.callId, "callId"));
        if (call.status !== "unknown") return view(call);
        return view(store.update(call.id, "unknown", { status: "aborted", updatedAt: store.now() }));
      },
    },
  ];
}

export function reconcileProjectCalls(store: ProjectCallStore, conversationId: string, liveSessionIds: ReadonlySet<string>): ProjectCall[] {
  return store.list(conversationId).map(call => {
    if ((call.status !== "accepted" && call.status !== "working") || (call.sessionId && liveSessionIds.has(call.sessionId))) return call;
    return store.update(call.id, call.status, { status: "unknown", updatedAt: store.now() });
  });
}

export function createCoordinatorBridgeExtension(store: ProjectCallStore, conversationId: string, maxParallel: number): ExtensionFactory {
  const tools = createProjectCallTools(store, conversationId, maxParallel);
  return (pi: ExtensionAPI) => {
    for (const tool of tools) {
      pi.registerTool({
        name: tool.name,
        label: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        async execute(_id, params) {
          const value = await tool.execute(params as Record<string, unknown>);
          return { content: [{ type: "text", text: JSON.stringify(value) }], details: value };
        },
      });
    }
  };
}
