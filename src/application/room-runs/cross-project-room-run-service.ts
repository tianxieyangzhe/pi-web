import { DomainError, optionalText, requiredText } from "@/domain/errors";
import type { RoomRun, Session, Task, TaskResult } from "@/domain/models";
import type {
  RoomRepositoryPort,
  RoomRunRepositoryPort,
  SessionCatalogPort,
  SessionRepositoryPort,
  TaskRepositoryPort,
} from "@/application/ports/core";
import type { ProjectRepositoryPort } from "@/application/ports/catalog";
import type { RouterDecision } from "@/infrastructure/pi/pi-room-router-runtime.server";
import type { RoomRunEvent } from "@/domain/room-run-events";

const locks = new Set<string>();
const activeRuns = new Map<string, { runId: string; controller: AbortController; sessionIds: Set<string> }>();

class EventQueue {
  private values: RoomRunEvent[] = [];
  private waiters: Array<(event: RoomRunEvent | null) => void> = [];
  private ended = false;
  push(event: RoomRunEvent) { const waiter = this.waiters.shift(); if (waiter) waiter(event); else this.values.push(event); }
  end() { this.ended = true; for (const waiter of this.waiters.splice(0)) waiter(null); }
  async next(): Promise<RoomRunEvent | null> { const event = this.values.shift(); if (event) return event; if (this.ended) return null; return new Promise((resolve) => this.waiters.push(resolve)); }
}

type Dependencies = {
  rooms: RoomRepositoryPort;
  runs: RoomRunRepositoryPort;
  tasks: TaskRepositoryPort;
  sessions: SessionRepositoryPort;
  catalog: SessionCatalogPort;
  projects: ProjectRepositoryPort;
  context: { build(roomId: string): { runtimeDirectory: string; context: string; cleanup(): void } };
  router: (input: { cwd: string; context: string; request: string; signal?: AbortSignal; emit?: (event: { type: "activity"; kind: "thinking" | "execution"; summary: string }) => void }) => Promise<RouterDecision>;
  direct: (input: { cwd: string; context: string; request: string; signal?: AbortSignal; emit: (event: { type: "response_delta"; text: string } | { type: "progress"; summary: string } | { type: "activity"; kind: "thinking" | "execution"; summary: string }) => void }) => Promise<string>;
  execution: {
    send(sessionId: string, instruction: string, operation: Task["operation"]): AsyncGenerator<import("@/domain/models").AgentEvent>;
    interrupt(sessionId: string): Promise<void>;
  };
};

function snapshotMatches(session: Session, agentId: string | null, mcpIds: string[]) {
  return session.agentId === agentId && session.mcpIds.length === mcpIds.length && session.mcpIds.every((id, index) => id === mcpIds[index]);
}

function taskResult(status: TaskResult["status"], summary: string): TaskResult {
  return { status, summary, artifacts: [], risks: status === "completed" ? [] : [summary], nextActions: [] };
}

function claimsUnperformedProjectWork(response: string) {
  return /(?:调度|派发|执行).{0,36}(?:项目|任务)|(?:已(?:经)?|正在|将|会|让我|请).{0,36}(?:查看|检查|读取|分析|执行).{0,36}(?:项目|文件|目录|代码)/.test(response);
}

type ModelActivity = { kind: "thinking" | "execution"; summary: string };
type ActivityState = "running" | "completed" | "error";
type ActivitySource = "router" | "session" | "direct" | "synthesizer";

function modelActivity(source: ActivitySource, event: ModelActivity, state: ActivityState = "running"): RoomRunEvent {
  return { type: "activity", id: `${source}:${event.kind}`, source, kind: event.kind, state, summary: event.summary };
}

function finishModelActivities(source: Exclude<ActivitySource, "session">, activities: Map<string, ModelActivity>, state: Exclude<ActivityState, "running">, emit: (event: RoomRunEvent) => void) {
  for (const activity of activities.values()) {
    const summary = state === "error"
      ? "阶段处理失败"
      : activity.kind === "thinking" ? "问题分析阶段已完成" : "计划阶段已完成";
    emit(modelActivity(source, { ...activity, summary }, state));
  }
}

export function createCrossProjectRoomRunService(dependencies: Dependencies) {
  const { rooms, runs, tasks, sessions, catalog, projects, context, router, direct, execution } = dependencies;

  function getRun(roomId: string, runId: string) {
    const run = runs.get(runId);
    if (!run || run.roomId !== roomId) throw new DomainError("NOT_FOUND", "请求不存在", 404, true);
    const room = rooms.get(roomId);
    if (!room || room.kind !== "cross_project") throw new DomainError("CROSS_PROJECT_ROOM_REQUIRED", "该接口只处理跨项目会话", 409, true);
    return run;
  }

  function validateDecision(roomId: string, decision: RouterDecision): RouterDecision {
    const scope = new Set(rooms.listProjects(roomId).map((item) => item.projectId));
    if (decision.kind === "direct") {
      if (!decision.response.trim()) throw new DomainError("INVALID_ROUTER_DECISION", "Router 没有提供直接回复", 502, true);
      if (claimsUnperformedProjectWork(decision.response)) {
        throw new DomainError("INVALID_ROUTER_DECISION", "直接回复不能承诺未创建的项目任务", 502, true);
      }
      return decision;
    }
    if (!decision.tasks.length || decision.tasks.length > 8) {
      throw new DomainError("INVALID_ROUTER_DECISION", "Router 任务数量必须在 1 到 8 之间", 502, true);
    }
    const selectedProjects = new Set<string>();
    for (const item of decision.tasks) {
      if (!item.projectId || selectedProjects.has(item.projectId)) throw new DomainError("INVALID_ROUTER_DECISION", "同一请求不能为同一项目创建重复任务", 502, true);
      if (!scope.has(item.projectId)) throw new DomainError("PROJECT_OUT_OF_SCOPE", "Router 选择了会话范围外的项目", 422, true);
      selectedProjects.add(item.projectId);
      const project = projects.get(item.projectId);
      if (!project || project.status !== "active") throw new DomainError("PROJECT_UNAVAILABLE", "Router 选择的项目不可用", 422, true);
      if (!item.instruction.trim() || !item.acceptance.length || item.acceptance.some((value) => !value.trim())) {
        throw new DomainError("INVALID_ROUTER_DECISION", "Router 任务缺少指令或验收条件", 502, true);
      }
      const mcpIds = [...new Set(item.mcpIds)];
      if (mcpIds.length !== item.mcpIds.length) throw new DomainError("INVALID_ROUTER_DECISION", "Router 包含重复 MCP", 502, true);
      if (item.agentId) {
        const agent = catalog.getAgent(item.agentId);
        if (!agent || agent.status !== "active") throw new DomainError("AGENT_UNAVAILABLE", "Router 选择的 Agent 不可用", 422, true);
        if (item.operation === "project_write" && !agent.policy.allowProjectWrite) {
          throw new DomainError("AGENT_POLICY_DENIED", "Agent 不允许项目写入", 422, true);
        }
      }
      for (const mcpId of mcpIds) {
        const mcp = catalog.getMcp(mcpId);
        if (!mcp || mcp.status !== "active") throw new DomainError("MCP_UNAVAILABLE", "Router 选择的 MCP 不可用", 422, true);
      }
      if (item.reuseSessionId) {
        const reusable = sessions.get(item.reuseSessionId);
        if (!reusable || reusable.roomId !== roomId || reusable.projectId !== item.projectId || !["not_started", "idle", "unavailable"].includes(reusable.state) || !snapshotMatches(reusable, item.agentId, mcpIds)) {
          throw new DomainError("SESSION_NOT_REUSABLE", "Router 选择的项目工作线不可复用", 422, true);
        }
      }
    }
    return decision;
  }

  function persistPlan(run: RoomRun, decision: Extract<RouterDecision, { kind: "dispatch" }>) {
    const created = decision.tasks.map((item) => tasks.create({
      roomId: run.roomId,
      runId: run.id,
      retryOfTaskId: null,
      projectId: item.projectId,
      sessionId: item.reuseSessionId,
      agentId: item.agentId,
      mcpIds: item.mcpIds,
      instruction: item.instruction.trim(),
      acceptance: item.acceptance.map((value) => value.trim()),
      operation: item.operation,
      risk: item.risk,
      state: item.operation === "read" && item.risk === "low" ? "queued" : "review_pending",
    }));
    return created;
  }

  function resolveSession(task: Task): Session {
    if (task.sessionId) {
      const existing = sessions.get(task.sessionId);
      if (!existing) throw new DomainError("SESSION_NOT_REUSABLE", "项目工作线不存在", 409, true);
      return existing;
    }
    const project = projects.get(task.projectId);
    if (!project || project.status !== "active") throw new DomainError("PROJECT_UNAVAILABLE", "项目不可用", 409, true);
    const agent = task.agentId ? catalog.getAgent(task.agentId) : null;
    const mcpSnapshots = task.mcpIds.map((id) => {
      const mcp = catalog.getMcp(id);
      if (!mcp || mcp.status !== "active") throw new DomainError("MCP_UNAVAILABLE", "MCP 不可用", 409, true);
      return mcp;
    });
    const created = sessions.create({
      roomId: task.roomId,
      projectId: task.projectId,
      purpose: task.instruction.slice(0, 160),
      agentId: agent?.id ?? null,
      agentSnapshot: agent,
      mcpIds: task.mcpIds,
      mcpSnapshots,
    });
    tasks.update(task.id, { sessionId: created.id });
    return created;
  }

  async function executeTask(taskId: string, active: { controller: AbortController; sessionIds: Set<string> }, emit: (event: RoomRunEvent) => void) {
    const current = tasks.get(taskId);
    if (!current) return;
    const session = resolveSession(current);
    active.sessionIds.add(session.id);
    tasks.update(current.id, { state: "running", startedAt: new Date().toISOString() });
    emit({ type: "task_state", taskId: current.id, state: "running" });
    let result: TaskResult | null = null;
    let failure: string | null = null;
    try {
      const instruction = `${current.instruction}\n\n验收条件：\n${current.acceptance.map((item, index) => `${index + 1}. ${item}`).join("\n")}`;
      for await (const event of execution.send(session.id, instruction, current.operation)) {
        if (event.type === "activity") {
          emit({ type: "task_progress", taskId: current.id, summary: event.summary });
          emit({
            type: "activity",
            id: `${session.id}:${event.id}`,
            source: "session",
            kind: event.kind === "thinking" ? "thinking" : "execution",
            state: event.state,
            summary: event.summary,
            taskId: current.id,
            sessionId: session.id,
            projectId: current.projectId,
          });
        }
        if (event.type === "session_state") {
          emit({
            type: "activity",
            id: `${session.id}:state`,
            source: "session",
            kind: "execution",
            state: event.state === "unavailable" ? "error" : event.state === "idle" || event.state === "ended" ? "completed" : "running",
            summary: event.state === "starting" ? "正在启动项目工作线" : event.state === "running" ? "项目工作线已开始执行" : event.state === "idle" ? "项目工作线执行完成" : event.state === "unavailable" ? "项目工作线不可用" : `项目工作线：${event.state}`,
            taskId: current.id,
            sessionId: session.id,
            projectId: current.projectId,
          });
        }
        if (event.type === "task_result") result = event.result;
        if (event.type === "error") failure = event.message;
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : "项目任务执行失败";
    } finally {
      active.sessionIds.delete(session.id);
    }
    if (active.controller.signal.aborted) return;
    if (!result) result = taskResult(failure ? "failed" : "blocked", failure ?? "项目工作线没有提交结构化结果");
    const state = result.status === "completed" ? "completed" : result.status === "blocked" ? "blocked" : "failed";
    tasks.update(current.id, { state, result, completedAt: new Date().toISOString() });
    emit({ type: "task_state", taskId: current.id, state });
  }

  async function executeQueued(run: RoomRun, active: { controller: AbortController; sessionIds: Set<string> }, emit: (event: RoomRunEvent) => void) {
    const queued = tasks.listForRun(run.id).filter((task) => task.state === "queued");
    if (!queued.length) return;
    runs.update(run.id, { state: "running" });
    emit({ type: "run_state", state: "running" });
    await Promise.all(queued.map((task) => executeTask(task.id, active, emit)));
    if (active.controller.signal.aborted) return;
    const results = tasks.listForRun(run.id);
    runs.update(run.id, { state: "synthesizing" });
    emit({ type: "run_state", state: "synthesizing" });
    const compiled = context.build(run.roomId);
    const synthesisRequest = [
      `用户请求：${run.requestText}`,
      "项目任务结果：",
      ...results.map((task) => `- ${task.projectId}: ${task.result?.status ?? task.state} — ${task.result?.summary ?? "未产生结果"}`),
      "请用中文向用户汇总完成情况、阻塞项、产物和下一步。不要声称未在结果中出现的事实。",
    ].join("\n");
    let response: string;
    const synthesisActivities = new Map<string, ModelActivity>();
    try {
      response = await direct({ cwd: compiled.runtimeDirectory, context: compiled.context, request: synthesisRequest, signal: active.controller.signal, emit(event) {
        if (event.type === "response_delta") emit(event);
        else if (event.type === "activity") {
          synthesisActivities.set(event.kind, event);
          emit(modelActivity("synthesizer", event));
        }
        else emit({ type: "progress", summary: event.summary });
      } });
      finishModelActivities("synthesizer", synthesisActivities, "completed", emit);
    } catch (error) {
      finishModelActivities("synthesizer", synthesisActivities, "error", emit);
      throw error;
    } finally { compiled.cleanup(); }
    if (active.controller.signal.aborted) return;
    runs.update(run.id, { state: "completed", finalResponse: response, completedAt: new Date().toISOString() });
    rooms.incrementContextRevision(run.roomId);
    emit({ type: "run_state", state: "completed" });
  }

  async function routeAndRun(run: RoomRun, active: { controller: AbortController; sessionIds: Set<string> }, emit: (event: RoomRunEvent) => void) {
    runs.update(run.id, { state: "routing", startedAt: new Date().toISOString() });
    emit({ type: "run_state", state: "routing" });
    emit({ type: "progress", summary: "正在选择资源" });
    const compiled = context.build(run.roomId);
    let decision: RouterDecision;
    const routerActivities = new Map<string, ModelActivity>();
    try {
      decision = validateDecision(run.roomId, await router({
        cwd: compiled.runtimeDirectory,
        context: compiled.context,
        request: run.requestText,
        signal: active.controller.signal,
        emit(event) {
          routerActivities.set(event.kind, event);
          emit(modelActivity("router", event));
        },
      }));
      finishModelActivities("router", routerActivities, "completed", emit);
      compiled.cleanup();
    } catch (error) {
      finishModelActivities("router", routerActivities, "error", emit);
      if (active.controller.signal.aborted) { compiled.cleanup(); return; }
      if (error instanceof DomainError) {
        compiled.cleanup();
        const message = "未生成可信的项目任务计划；没有项目任务被启动。请调整请求后重试。";
        runs.update(run.id, { state: "blocked", errorCode: error.code, completedAt: new Date().toISOString() });
        rooms.incrementContextRevision(run.roomId);
        emit({ type: "run_state", state: "blocked" });
        emit({ type: "error", code: error.code, message, recoverable: true });
        return;
      }
      const fallbackActivity = { type: "activity", id: "router-fallback", source: "router", kind: "thinking", state: "running", summary: "路由计划不可用，正在直接回答" } as const;
      emit(fallbackActivity);
      let response: string;
      const fallbackActivities = new Map<string, ModelActivity>();
      try {
        response = await direct({
          cwd: compiled.runtimeDirectory,
          context: compiled.context,
          request: run.requestText,
          signal: active.controller.signal,
          emit(event) {
            if (event.type === "response_delta") emit(event);
            else if (event.type === "activity") {
              fallbackActivities.set(event.kind, event);
              emit(modelActivity("direct", event));
            }
            else emit({ type: "progress", summary: event.summary });
          },
        });
        finishModelActivities("direct", fallbackActivities, "completed", emit);
        emit({ ...fallbackActivity, state: "completed", summary: "已完成直接回复" });
      } catch (directError) {
        finishModelActivities("direct", fallbackActivities, "error", emit);
        emit({ ...fallbackActivity, state: "error", summary: "直接回复失败" });
        throw directError;
      } finally { compiled.cleanup(); }
      if (active.controller.signal.aborted) return;
      if (!response) throw new DomainError("EMPTY_RESPONSE", "模型没有返回可用回复", 502, true);
      runs.update(run.id, { route: "direct", state: "completed", routerSummary: "Router 回退为直接回复", finalResponse: response, completedAt: new Date().toISOString() });
      rooms.incrementContextRevision(run.roomId);
      emit({ type: "route_selected", route: "direct" });
      emit({ type: "run_state", state: "completed" });
      return;
    }
    if (active.controller.signal.aborted) return;
    if (decision.kind === "direct") {
      if (active.controller.signal.aborted) return;
      runs.update(run.id, { route: "direct", state: "completed", finalResponse: decision.response, completedAt: new Date().toISOString() });
      rooms.incrementContextRevision(run.roomId);
      emit({ type: "route_selected", route: "direct" });
      emit({ type: "response_delta", text: decision.response });
      emit({ type: "run_state", state: "completed" });
      return;
    }
    const route = decision.tasks.length === 1 ? "single_project" : "multi_project";
    const plan = persistPlan(run, decision);
    const pending = plan.filter((task) => task.state === "review_pending");
    runs.update(run.id, { route, state: pending.length ? "review_pending" : "dispatching", routerSummary: `${plan.length} 个项目任务` });
    emit({ type: "route_selected", route });
    emit({ type: "plan_proposed", tasks: plan });
    if (pending.length) {
      for (const task of pending) emit({ type: "approval_required", taskId: task.id, summary: task.instruction });
      emit({ type: "run_state", state: "review_pending" });
      return;
    }
    await executeQueued(run, active, emit);
  }

  function stream(run: RoomRun, active: { controller: AbortController; sessionIds: Set<string> }, work: (emit: (event: RoomRunEvent) => void) => Promise<void>) {
    return (async function* (): AsyncGenerator<RoomRunEvent> {
      try {
        yield { type: "run_created", runId: run.id };
        const queue = new EventQueue();
        const pending = work((event) => queue.push(event)).finally(() => queue.end());
        while (true) { const event = await queue.next(); if (!event) break; yield event; }
        await pending;
        if (active.controller.signal.aborted) {
          yield { type: "run_state", state: "cancelled" };
        } else yield { type: "complete" };
      } catch (error) {
        if (!active.controller.signal.aborted) {
          runs.update(run.id, { state: "failed", errorCode: error instanceof DomainError ? error.code : "RUNTIME_ERROR", completedAt: new Date().toISOString() });
          yield { type: "error", code: error instanceof DomainError ? error.code : "RUNTIME_ERROR", message: error instanceof Error ? error.message : "请求运行失败", recoverable: true };
        }
      } finally {
        activeRuns.delete(run.roomId);
        locks.delete(run.roomId);
      }
    })();
  }

  return {
    list(roomId: string) { if (!rooms.get(roomId)) throw new DomainError("NOT_FOUND", "会话不存在", 404, true); return runs.listForRoom(roomId); },
    get: getRun,
    submit(roomId: string, body: Record<string, unknown>): AsyncGenerator<RoomRunEvent> {
      const room = rooms.get(roomId);
      if (!room) throw new DomainError("NOT_FOUND", "会话不存在", 404, true);
      if (room.kind !== "cross_project") throw new DomainError("CROSS_PROJECT_ROOM_REQUIRED", "项目会话不能调用跨项目 Router", 409, true);
      if (room.status !== "active") throw new DomainError("ROOM_NOT_ACTIVE", "当前会话不能接收请求", 409, true);
      if (locks.has(roomId)) throw new DomainError("ROOM_ROUTING_BUSY", "当前会话正在处理另一条请求", 409, true);
      const requestText = requiredText(body.request, "request", "请求");
      const projectHintId = optionalText(body.projectHintId);
      if (projectHintId && !rooms.listProjects(roomId).some((item) => item.projectId === projectHintId)) {
        throw new DomainError("PROJECT_OUT_OF_SCOPE", "项目提示不属于当前会话", 422, true);
      }
      locks.add(roomId);
      const run = runs.create({ roomId, requestText, projectHintId, contextRevision: room.contextRevision });
      const active = { runId: run.id, controller: new AbortController(), sessionIds: new Set<string>() };
      activeRuns.set(roomId, active);
      return stream(run, active, (emit) => routeAndRun(run, active, emit));
    },
    approve(roomId: string, runId: string): AsyncGenerator<RoomRunEvent> {
      const run = getRun(roomId, runId);
      if (run.state !== "review_pending") throw new DomainError("RUN_NOT_REVIEW_PENDING", "当前请求不等待审查", 409, true);
      if (locks.has(roomId)) throw new DomainError("ROOM_ROUTING_BUSY", "当前会话正在处理另一条请求", 409, true);
      locks.add(roomId);
      for (const task of tasks.listForRun(runId).filter((task) => task.state === "review_pending")) tasks.update(task.id, { state: "queued" });
      const active = { runId: run.id, controller: new AbortController(), sessionIds: new Set<string>() };
      activeRuns.set(roomId, active);
      return stream(run, active, (emit) => executeQueued(run, active, emit));
    },
    async cancel(roomId: string, runId: string) {
      const run = getRun(roomId, runId);
      if (["completed", "failed", "blocked", "cancelled"].includes(run.state)) {
        throw new DomainError("RUN_NOT_CANCELLABLE", "当前请求不能停止", 409, true);
      }
      const active = activeRuns.get(roomId);
      if (active && active.runId === runId) {
        active.controller.abort();
        await Promise.all([...active.sessionIds].map(async (sessionId) => {
          try { await execution.interrupt(sessionId); } catch { /* The runtime may already be ending. */ }
        }));
      }
      for (const task of tasks.listForRun(runId)) {
        if (["proposed", "review_pending", "approved", "queued"].includes(task.state)) tasks.update(task.id, { state: "cancelled" });
      }
      runs.update(runId, { state: "cancelled", completedAt: new Date().toISOString() });
      rooms.incrementContextRevision(roomId);
      return getRun(roomId, runId);
    },
  };
}
