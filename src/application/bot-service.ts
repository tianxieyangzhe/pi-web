import { SessionEvents } from "./session-events";
import { SessionPresence } from "./session-presence";
import { createBotConfiguration } from "./bots/configuration-service";
import { roleState } from "@/domain/role-state";
import type { AgentSnapshot, Session } from "@/domain/models";
import { boundRole, requireRole, isRoleSnapshot } from "@/domain/agent-definition";
import { randomUUID } from "node:crypto";
import { DomainError } from "@/domain/errors";
import { botText, botETag, safeBotContent, type BotConversation, type BotLiveEvent } from "@/domain/bot";
import type { BotRepositoryPort, BotWorkspacePort, BotRuntimePort, BotRuntimeInput, BotTool } from "./ports/bot";
import type { SessionRepositoryPort, SessionCatalogPort } from "./ports/core";
import type { ProjectRepositoryPort } from "./ports/catalog";
import { sessionLocks } from "./session-lock";
import { emptyInspection, type NativeContextInspection } from "@/domain/native-context";
import { coordinatorProjectPresenceTools } from "@/infrastructure/pi/coordinator-project-tools";
import { createProjectCallTools, reconcileProjectCalls, type ProjectCallStore, type ProjectSessionHandle } from "@/infrastructure/pi/coordinator-bridge-plugin";
import { coordinatorDiagnostic, coordinatorErrorCode } from "@/infrastructure/pi/coordinator-diagnostics";
import { parseMessageReferences, type ProjectMessageReference } from "@/domain/message-references";

const stamp = () => new Date().toISOString();
const guidance = "你是协调会话中的协调者。用户输入只进入协调会话；项目工作只能通过项目调用工具发起。工具立即返回，不代表项目已经完成。项目输出只在调用完成后按 transcript 边界读取。不得直接搜索、读取或修改项目代码，也不得绕过项目调用向项目 Session 输入。";

export type BotServiceDependencies = {
  repository: BotRepositoryPort;
  workspace: BotWorkspacePort;
  runtime: BotRuntimePort;
  runtimeInstanceId: string;
  sessions: SessionRepositoryPort;
  projects: ProjectRepositoryPort;
  readProjectReference?: (reference: ProjectMessageReference) => { name: string; data: string };
  readBotReference?: (root: string, path: string) => { name: string; data: string };
  catalog?: SessionCatalogPort;
  compactions?: Map<string, { state: "running" | "cancelled" | "failed"; error: string | null }>;
};

export function createBotService(d: BotServiceDependencies) {
  const r = d.repository;
  const active = new Map<string, AbortController>();
  const compactions = d.compactions ?? new Map<string, { state: "running" | "cancelled" | "failed"; error: string | null }>();
  d.compactions = compactions;
  const handles = new Map<string, ProjectSessionHandle>();
  const configuration = createBotConfiguration(d, { bot, conversation, eligible, role, participantForSession, wake: () => undefined, detail });
  const subscribers = new Map<string, Set<(event: BotLiveEvent) => void>>();

  const observers = new Map<string, () => void>();
  const opening = new Map<string, Promise<void>>();
  const openKeys = new Map<string, { id: string; expires: number; result: Promise<{ leaseId: string; status: string; outcome: null }> }>();
  const presence = new SessionPresence({ busy: id => active.has(id), abort: id => d.runtime.abort("bot:" + id), release: async id => { observers.get(id)?.(); observers.delete(id); await d.runtime.close?.("bot:" + id); } });
  const events = new SessionEvents(presence);

  function bot(botId: string) {
    const value = r.get("bots", botId);
    if (!value) throw new DomainError("NOT_FOUND", "Bot 不存在", 404, true);
    return value;
  }
  function conversation(conversationId: string, botId?: string) {
    const value = r.get("bot_conversations", conversationId);
    if (!value || botId && value.botId !== botId) throw new DomainError("NOT_FOUND", "协调会话不存在", 404, true);
    return value;
  }
  function eligible(conversationId: string) {
    const value = conversation(conversationId);
    if (bot(value.botId).status !== "active") throw new DomainError("BOT_UNAVAILABLE", "Bot 已停用", 409, true);
    return value;
  }
  function role(value: BotConversation, session?: Session | null): AgentSnapshot {
    if (session) {
      if (!isRoleSnapshot(session.agentSnapshot)) throw new DomainError("ROLE_BINDING_INVALID", "项目 Session 缺少角色快照", 409, true);
      return requireRole(d.catalog?.getAgentVersion(session.agentSnapshot.agentId, session.agentSnapshot.revision, session.agentSnapshot.contentSha256) ?? null, "project", session.projectId);
    }
    return boundRole(d.catalog?.getAgent(value.coordinatorAgentId) ?? null, value.coordinatorAgentSnapshot, "coordinator", value.botId);
  }
  function participantForSession(sessionId: string) {
    return r.parentForSession(sessionId) ? d.sessions.get(sessionId) : null;
  }
  function publish(conversationId: string, event: BotLiveEvent) {
    if (event.type === "project_call") events.publish(conversationId, { sessionId: conversationId, runId: null, sequence: null, type: "project_call", entryId: null, temporaryId: null, payload: event });
    for (const listener of subscribers.get(conversationId) ?? []) { try { listener(event); } catch { /* observer failure is isolated */ } }
  }
  function projectFor(projectId: string) {
    const project = d.projects.get(projectId);
    if (!project || project.status !== "active") throw new DomainError("PROJECT_UNAVAILABLE", "项目不可用", 409, true);
    return project;
  }
  function ensureProjectSession(c: BotConversation, projectId: string) {
    const existing = r.participants(c.id).map(item => d.sessions.get(item.id)).find(session => session?.projectId === projectId && session.botConversationId === c.id);
    if (existing) return existing;
    const binding = r.conversationConfiguration(c.id).find(item => item.projectId === projectId)?.agents[0];
    if (!binding) throw new DomainError("NOT_FOUND", "项目不在当前协调会话范围", 404, true);
    const selected = requireRole(d.catalog?.getAgentVersion(binding.agentId, binding.revision, binding.contentSha256) ?? null, "project", projectId);
    const created = d.sessions.create({projectId, purpose:"项目会话", agentId:selected.agentId, agentSnapshot:selected, mcpIds:[], mcpSnapshots:[]});
    r.updateParticipant(created.id, { botConversationId: c.id, participantName: selected.name, assignment: null, collaborationState: "active", botJoinedAt: stamp() });
    return d.sessions.get(created.id)!;
  }
  async function sessionHandle(session: Session): Promise<ProjectSessionHandle> {
    if (!d.runtime.projectHandle) throw new DomainError("RUNTIME_ERROR", "项目会话端口不可用", 503, true);
    const project = projectFor(session.projectId);
    const snapshot = isRoleSnapshot(session.agentSnapshot) ? session.agentSnapshot : null;
    const handle = await d.runtime.projectHandle({
      session, workingDirectory: project.rootPath, allowProjectWrite: snapshot?.definition.capabilities.writeFiles === true,
      allowProjectRead: snapshot?.definition.capabilities.readFiles === true, projectSession: true, roleInstructions: snapshot?.definition.instructions ?? "",
    });
    handles.set(session.id, handle);
    return handle;
  }
  function storeFor(c: BotConversation): ProjectCallStore {
    return {
      now: stamp,
      nextId: () => randomUUID(),
      get: callId => r.get("project_calls", callId),
      findDuplicate: input => r.findProjectCall(input.conversationId, input.projectId, input.sourceEntryId, input.sentContent),
      list: () => r.projectCalls(c.id),
      insert: call => r.insert("project_calls", call),
      update: (callId, expected, patch) => r.updateProjectCall(callId, expected, patch),
      agent: (_conversationId, projectId) => {
        const binding = r.conversationConfiguration(c.id).find(item => item.projectId === projectId)?.agents[0];
        if (!binding) return null;
        const version = d.catalog?.getAgentVersion(binding.agentId, binding.revision, binding.contentSha256);
        return version ? { agentId: version.id, revision: version.revision, name: version.name, responsibility: version.description ?? "", boundary: version.definition?.instructions ?? "" } : null;
      },
      sessionFor: async (_conversationId, projectId) => sessionHandle(ensureProjectSession(c, projectId)),
      notify: (callId, progress) => publish(c.id, { type: "project_call", callId, progress }),
    };
  }
  function bridgeTools(c: BotConversation): BotTool[] {
    return createProjectCallTools(storeFor(c), c.id, bot(c.botId).maxParallelExecutions).map(tool => ({
      name: tool.name, description: tool.description,
      parameters: { type: "object", properties: Object.fromEntries(Object.keys((tool.parameters as { properties?: object }).properties ?? {}).map(key => [key, { type: "string" }])), required: Object.keys((tool.parameters as { properties?: object }).properties ?? {}), additionalProperties: false },
      execute: async args => {
        const started = performance.now();
        coordinatorDiagnostic({ conversationId: c.id, tool: tool.name, stage: "tool_start" });
        try {
          const result = await tool.execute(args);
          coordinatorDiagnostic({ conversationId: c.id, tool: tool.name, stage: "tool_returned", elapsedMs: Math.round(performance.now() - started) });
          return result;
        } catch (error) {
          coordinatorDiagnostic({ conversationId: c.id, tool: tool.name, stage: "tool_failed", errorCode: coordinatorErrorCode(error), elapsedMs: Math.round(performance.now() - started) });
          throw error;
        }
      },
    }));
  }
  function runtimeInput(c: BotConversation): BotRuntimeInput {
    const owner = bot(c.botId), snapshot = role(c);
    const projects = r.conversationConfiguration(c.id).map(item => projectFor(item.projectId));
    return {
      identity: "bot:" + c.id, cwd: owner.workingDirectory, sessionDirectory: d.workspace.sessionDirectory(c.botId), nativeRef: c.nativeRef,
      instructions: guidance + "\n协调角色：\n" + snapshot.definition.instructions,
      tools: [...coordinatorProjectPresenceTools(projects), ...bridgeTools(c)], allowWrite: false, allowRead: false,
      kind: "coordinator", executionId: c.id, signal: active.get(c.id)?.signal,
    };
  }
  async function detail(conversationId: string, cursors: Record<string, string | undefined> = {}) {
    const c = conversation(conversationId), owner = bot(c.botId), items = r.projectCalls(conversationId);
    const calls = await Promise.all(items.map(async call => {
      if (call.status !== "completed" || !call.sessionId || !call.startEntryId || !call.endEntryId) return { ...call, output: null, outputError: null };
      try {
        const output = await sessionHandle(ensureProjectSession(c, call.projectId)).then(handle => handle.readAssistant(call.startEntryId!, call.endEntryId!));
        return { ...call, output, outputError: output.trim() ? null : "项目调用已完成，但没有可展示的最终输出" };
      } catch (error) {
        return { ...call, output: null, outputError: error instanceof Error ? error.message : "无法读取项目调用输出" };
      }
    }));
    return {
      bot: { ...owner, projectBindings: r.botConfiguration(owner.id), writeETag: botETag({ ...owner, projectBindings: r.botConfiguration(owner.id) }) },
      conversation: { ...c, projectBindings: r.conversationConfiguration(c.id), writeETag: botETag({ ...c, projectBindings: r.conversationConfiguration(c.id) }), stats: r.conversationStats(c.id) },
      participants: r.participants(conversationId).map(item => ({ ...item, calls: calls.filter(call => call.sessionId === item.id) })),
      calls, works: [], tasks: [], executions: [], messages: [], dependencies: [],
      role: roleState(d.catalog?.getAgent(c.coordinatorAgentId) ?? null, { ...c.coordinatorAgentSnapshot, definition: role(c).definition }, !!c.nativeRef, items.some(call => ["accepted", "working", "unknown"].includes(call.status))),
      blockingReasons: items.filter(call => call.status === "unknown").map(call => ({ code: "PROJECT_CALL_UNKNOWN", entityType: "project_call", entityId: call.id, reason: "项目调用结果未知，需明确放弃后才能继续该项目" })),
      allowedActions: [{ action: "send", entityType: "conversation", entityId: c.id }, { action: "delete", entityType: "conversation", entityId: c.id }],
    };
  }

  return {
    ...configuration,
    referenceContractVersion: 7,
    events,
    async open(botId: string, conversationId: string, key: string) {
      const c = conversation(conversationId, botId);
      for (const [storedKey, entry] of openKeys) if (entry.expires <= Date.now()) openKeys.delete(storedKey);
      const previous = openKeys.get(key);
      if (previous) { if (previous.id !== conversationId) throw new DomainError("IDEMPOTENCY_CONFLICT", "打开幂等键已用于其他会话", 409, true); return previous.result; }
      const result = (async () => {
      if (!d.runtime.open) throw new DomainError("RUNTIME_NOT_OPEN", "协调运行端口需要更新", 503, true);
      let pending = opening.get(c.id);
      if (!pending) {
        pending = d.runtime.open(runtimeInput(c), ref => { if (!c.nativeRef) r.update("bot_conversations", c.id, { nativeRef: ref }); }).then(() => {
          if (!observers.has(c.id) && d.runtime.subscribe) observers.set(c.id, d.runtime.subscribe("bot:" + c.id, event => events.agent(c.id, event)));
        }).finally(() => opening.delete(c.id));
        opening.set(c.id, pending);
      }
      await pending;
      return { leaseId: presence.open(c.id), status: active.has(c.id) ? "running" : "ready", outcome: null };
      })();
      openKeys.set(key, { id: conversationId, expires: Date.now() + 600_000, result });
      try { return await result; } catch (error) { openKeys.delete(key); throw error; }
    },
    pong(botId: string, conversationId: string, connectionId: string, challenge: string) { conversation(conversationId, botId); events.pong(conversationId, connectionId, challenge); },
    closeLease(botId: string, conversationId: string, leaseId: string) { conversation(conversationId, botId); presence.release(conversationId, leaseId); },
    assertLease(botId: string, conversationId: string, leaseId: string) { conversation(conversationId, botId); presence.assertLease(conversationId, leaseId); },
    list: () => ({ available: r.available(), bots: r.list("bots").map(item => ({ ...item, projectBindings: r.botConfiguration(item.id), writeETag: botETag({ ...item, projectBindings: r.botConfiguration(item.id) }) })), conversations: r.list("bot_conversations").map(item => ({ ...item, status: "open" as const, projectBindings: r.conversationConfiguration(item.id), writeETag: botETag({ ...item, projectBindings: r.conversationConfiguration(item.id) }), stats: r.conversationStats(item.id) })), participants: r.list("bot_conversations").flatMap(item => r.participants(item.id).map(participant => { const session = d.sessions.get(participant.id), project = session ? d.projects.get(session.projectId) : null; return { ...participant, projectId: session?.projectId ?? "", projectName: project?.name, roleName: session?.agentSnapshot && "name" in session.agentSnapshot ? session.agentSnapshot.name : participant.participantName ?? "项目会话", topic: session?.purpose, writeETag: botETag(participant) }; })) }),
    detail, participantForSession,
    assertSessionAllowed(sessionId: string) { if (participantForSession(sessionId)?.botConversationId) throw new DomainError("SESSION_ALREADY_ATTACHED", "纳入协调会话的项目 Session 不能直接输入", 409, true); },
    assertCanEnd(sessionId: string) {
      const session = participantForSession(sessionId);
      if (session?.botConversationId && r.projectCalls(session.botConversationId).some(call => call.sessionId === sessionId && ["accepted", "working", "unknown"].includes(call.status))) throw new DomainError("SESSION_BUSY", "请先处理该项目的未完成或未知调用", 409, true);
    },
    async interruptSession(sessionId: string) {
      const session = participantForSession(sessionId);
      if (!session?.botConversationId) return false;
      await d.runtime.abort("bot:" + session.botConversationId); await d.runtime.abort(sessionId); return true;
    },
    send(botId: string, conversationId: string, content: string, _key: string, targetSessionId?: string | null, references?: unknown) {
      if (targetSessionId) throw new DomainError("INVALID_BOT_INPUT", "协调输入不能指定项目 Session", 422, true);
      const c = eligible(conversationId);
      if (c.botId !== botId) throw new DomainError("NOT_FOUND", "协调会话不存在", 404, true);
      const text = botText(content, "输入", 100000);
      if (active.has(conversationId)) throw new DomainError("SESSION_BUSY", "协调会话正在处理", 409, true);
      const bound = r.conversationConfiguration(c.id).filter(item => d.projects.get(item.projectId)?.status === "active");
      const owner = bot(c.botId);
      const referenceContent = parseMessageReferences(references, new Set(bound.map(item => item.projectId)), d.readProjectReference, d.readBotReference ? ref => d.readBotReference!(owner.workingDirectory, ref.path) : undefined);
      const controller = new AbortController(); active.set(conversationId, controller); sessionLocks.add("bot:" + conversationId);
      let released = false;
      const release = () => { if (released) return; released = true; active.delete(conversationId); sessionLocks.delete("bot:" + conversationId); presence.settled(conversationId); };
      const started = performance.now();
      coordinatorDiagnostic({ conversationId, stage: "run_start" });
      void d.runtime.run({ ...runtimeInput(c), referenceContent }, text, ref => { if (!c.nativeRef) r.update("bot_conversations", c.id, { nativeRef: ref }); }, event => { publish(conversationId, { type: "event", event }); if (event.type !== "pi_event" && event.type !== "entry_link") events.agent(conversationId, event); if (event.type === "complete" || event.type === "error") { coordinatorDiagnostic({ conversationId, stage: event.type === "complete" ? "run_complete_event" : "run_error_event", elapsedMs: Math.round(performance.now() - started) }); } })
        .then(() => { coordinatorDiagnostic({ conversationId, stage: "run_returned", elapsedMs: Math.round(performance.now() - started) }); })
        .catch(error => { coordinatorDiagnostic({ conversationId, stage: "run_failed", errorCode: coordinatorErrorCode(error), elapsedMs: Math.round(performance.now() - started) }); events.agent(conversationId, { type: "error", recoverable: true, code: "RUNTIME_ERROR", message: "协调会话执行失败，请核对历史" }); publish(conversationId, { type: "error", code: error instanceof DomainError ? error.code : "RUNTIME_ERROR", message: error instanceof Error ? error.message : "协调会话失败" }); })
        .finally(release);
      return { accepted: true, conversationId };
    },
    async messages(botId: string, conversationId: string) { const c = conversation(conversationId, botId); if (!d.runtime.readTree) throw new DomainError("SESSION_TREE_READ_FAILED", "协调树读取端口不可用", 503, true); return d.runtime.readTree(runtimeInput(c)); },
    subscribeLive(botId: string, conversationId: string, listener: (event: BotLiveEvent) => void) {
      conversation(conversationId, botId); const set = subscribers.get(conversationId) ?? new Set(); set.add(listener); subscribers.set(conversationId, set); return () => set.delete(listener);
    },
    async inspect(botId: string, conversationId: string): Promise<NativeContextInspection> { const c = conversation(conversationId, botId); return c.nativeRef ? d.runtime.inspect(runtimeInput(c)) : emptyInspection("协调会话尚无原生历史"); },
    async compact(botId: string, conversationId: string) {
      const c = eligible(conversationId);
      if (c.botId !== botId || !c.nativeRef) throw new DomainError("NO_NATIVE_REF", "协调会话尚无原生历史", 409, true);
      compactions.set(conversationId, { state: "running", error: null });
      try { await d.runtime.compact(runtimeInput(c)); compactions.set(conversationId, { state: "cancelled", error: null }); }
      catch (error) { compactions.set(conversationId, { state: "failed", error: error instanceof Error ? safeBotContent(error.message) : "压缩失败" }); throw error; }
    },
    cancelCompaction(botId: string, conversationId: string) { conversation(conversationId, botId); d.runtime.cancelCompaction("bot:" + conversationId); compactions.set(conversationId, { state: "cancelled", error: null }); },
    recover() { for (const item of r.list("bot_conversations")) reconcileProjectCalls(storeFor(item), item.id, new Set(handles.keys())); void d.runtimeInstanceId; void 1; },
    retired(name: string): never { throw new DomainError("NOT_FOUND", `${name}不属于当前协调会话模型`, 404, true); },
    task: () => retiredAction(), retry: () => retiredAction(), stopWork: async () => retiredAction(), cancelQueued: () => retiredAction(),
    cancelQueuedMessage: () => retiredAction(), withdrawUnknownMessage: () => retiredAction(), resolveMessageDelivery: async () => retiredAction(),
    retryReceivedMessage: () => retiredAction(), retryPreflightMessage: () => retiredAction(), resolve: async () => retiredAction(), control: async () => retiredAction(),
  };
}
function retiredAction(): never { throw new DomainError("NOT_FOUND", "该操作不属于当前协调会话模型", 404, true); }
