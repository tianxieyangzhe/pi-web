import { SessionEvents } from "./session-events";
import {boundRole, isRoleSnapshot} from "@/domain/agent-definition";
import { DomainError } from "@/domain/errors";
import type { AgentEvent, Session } from "@/domain/models";
import type { SessionCatalogPort, SessionRepositoryPort } from "@/application/ports/core";
import type { ProjectRepositoryPort } from "@/application/ports/catalog";
import type { PiRuntimePort, SessionRuntimeInput } from "@/application/ports/pi-runtime";

import { sessionLocks as locks, acquireSession,acquireProjectWrite,projectWriteRoots } from "./session-lock";
import { createProjectMessageTiming } from "./project-message-timing";
import { parseMessageReferences, type ProjectMessageReference, type ProjectReferenceTarget } from "@/domain/message-references";

class EventQueue {
  private values: AgentEvent[] = [];
  private waiters: Array<(value: AgentEvent | null) => void> = [];
  private ended = false;

  push(value: AgentEvent) {
    const waiter = this.waiters.shift();
    if (waiter) waiter(value);
    else this.values.push(value);
  }

  end() {
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter(null);
  }

  async next(): Promise<AgentEvent | null> {
    const value = this.values.shift();
    if (value) return value;
    if (this.ended) return null;
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

export function createSessionExecutionService(dependencies: {
  sessions: SessionRepositoryPort;
  catalog: SessionCatalogPort;
  projects: ProjectRepositoryPort;
  resolveProjectReference?: (reference: ProjectMessageReference) => ProjectReferenceTarget;
  runtime: PiRuntimePort;
  openHistory?:import('./ports/session-open-history').SessionOpenHistory;
}) {
  const { sessions, catalog, projects, runtime } = dependencies;
  const controls = new Map<string, {
    cancelRequested: boolean;
    handle?: object;
    interruptPromise?: Promise<void>;
    done: Promise<void>;
    complete: () => void;
  }>();

  const deleting = new Set<string>(),closing=new Set<string>();
  const openings = new Map<string, Promise<object | null>>();
  const leases = new Map<string, { sessionId: string; expires: number }>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const timeouts = new Set<string>();
  const lastTimeouts = new Set<string>();
  const idempotency = new Map<string, { sessionId: string; expires: number; promise: Promise<{ leaseId: string; status: string; outcome: string | null }> }>();
  function hasLease(id: string) {
    const now = Date.now();
    for (const [key, lease] of leases) if (lease.expires <= now) leases.delete(key);
    return [...leases.values()].some(lease => lease.sessionId === id);
  }
  function clearTimer(id: string) { const timer = timers.get(id); if (timer) clearTimeout(timer); timers.delete(id); }
  function schedule(id: string) {
    clearTimer(id);
    if (hasLease(id)) {
      const expiry = Math.min(...[...leases.values()].filter(l => l.sessionId === id).map(l => l.expires));
      const timer = setTimeout(() => schedule(id), Math.max(1, expiry - Date.now())); timer.unref?.(); timers.set(id, timer); return;
    }
    if (openings.has(id)) return;
    if (!controls.has(id) && locks.has(id)) {
      const timer = setTimeout(() => schedule(id), 1000); timer.unref?.(); timers.set(id, timer); return;
    }
    if (controls.has(id)) {
      const timer = setTimeout(() => {
        timers.delete(id); if (hasLease(id)) return;
        const control = controls.get(id); if (!control?.handle) { schedule(id); return; }
        timeouts.add(id); control.cancelRequested = true;
        control.interruptPromise ??= runtime.interrupt(control.handle);
        void control.interruptPromise.catch(() => { timeouts.delete(id); });
      }, 300_000); timer.unref?.(); timers.set(id, timer); return;
    }
    const handle = runtime.getHandle(id); if (handle) { observed.get(id)?.unsubscribe(); observed.delete(id); void runtime.close(handle); }
  }
  function assertLease(id: string, leaseId: string | null) {
    const lease = leaseId ? leases.get(leaseId) : undefined;
    if (!lease || lease.sessionId !== id || lease.expires <= Date.now()) throw new DomainError("RUNTIME_NOT_OPEN", "请先打开项目会话", 409, true);
  }

  const observed = new Map<string, { handle: object; unsubscribe: () => void }>();
  const events = new SessionEvents({ assertLease, renew: (id, leaseId) => {
    assertLease(id, leaseId); leases.get(leaseId)!.expires = Date.now() + 120_000; schedule(id);
  }, release: (id, leaseId) => { if (leases.get(leaseId)?.sessionId === id) { leases.delete(leaseId); schedule(id); } } },undefined,id=>({running:controls.has(id),compacting:!controls.has(id)&&locks.has(id)}));
  function observe(id: string, handle: object) {
    if (observed.get(id)?.handle === handle) return;
    observed.get(id)?.unsubscribe();
    if (runtime.subscribe) observed.set(id, { handle, unsubscribe: runtime.subscribe(handle, event => events.agent(id, event)) });
  }

  function session(id: string): Session {
    const value = sessions.get(id);
    if (!value) throw new DomainError("NOT_FOUND", "项目工作线不存在", 404, true);
    return value;
  }

  function projectRole(value: Session) {
    if (!isRoleSnapshot(value.agentSnapshot) || !value.agentId) return null;
    try {
      return boundRole(catalog.getAgent(value.agentId), value.agentSnapshot, "project", value.projectId);
    } catch (error) {
      if (error instanceof DomainError && (error.code.startsWith("ROLE_") || error.code === "INVALID_ROLE")) return null;
      throw error;
    }
  }

  function runtimeInput(value: Session, allowProjectWrite = false): SessionRuntimeInput {
    const project = projects.get(value.projectId);
    if (!project || project.status !== "active") {
      throw new DomainError("PROJECT_UNAVAILABLE", "项目不存在或当前不可用", 409, true);
    }
    const role = projectRole(value);
    for (const id of value.mcpIds) {
      if (catalog.getMcp(id)?.status !== "active") {
        throw new DomainError("MCP_UNAVAILABLE", `MCP ${id} 已不可用`, 409, true);
      }
    }
    if (value.mcpIds.length > 0) {
      throw new DomainError("MCP_RUNTIME_UNAVAILABLE", "MCP 客户端尚未安装", 503, true);
    }
    return {
      session: { ...value, agentSnapshot: role },
      allowProjectRead: true,
      nativeCodingTools: true,
      workingDirectory: project.rootPath,
      allowProjectWrite,
    };
  }

  return {
    referenceContractVersion: 6,
    hasLease,
    async open(sessionId: string, key: string, readOnly = false) {
      if (deleting.has(sessionId)||closing.has(sessionId)) throw new DomainError('SESSION_BUSY', '会话正在关闭或删除', 409, true);
      session(sessionId);
      const now = Date.now();
      for (const [storedKey, record] of idempotency) if (record.expires <= now) idempotency.delete(storedKey);
      const scopedKey = sessionId + ":" + key;
      const existing = idempotency.get(scopedKey);
      if (existing) { if (existing.sessionId !== sessionId) throw new DomainError("IDEMPOTENCY_CONFLICT", "幂等键已用于其他会话", 409, true); return existing.promise; }
      clearTimer(sessionId);
      const promise = (async () => {
        let opening = openings.get(sessionId);
        if (!opening) {
          opening = (async () => {
            const value = session(sessionId);
            if (readOnly) {
              if (!value.nativeRef) throw new DomainError("NO_NATIVE_REF", "会话没有原生历史", 409, true);
              if (!runtime.readTree) throw new DomainError("SESSION_TREE_READ_FAILED", "原生树读取不可用", 500, true);
              const project = projects.get(value.projectId); if (!project) throw new DomainError("NOT_FOUND", "项目不存在", 404, true);
              await runtime.readTree({ session: value, workingDirectory: project.rootPath, allowProjectWrite: false }); return null;
            }
            const live = runtime.getHandle(sessionId);
            if (live) {
              if(controls.has(sessionId)||locks.has(sessionId)||runtime.isBusy?.(live))return live;
              acquireSession(sessionId);
              try {await runtime.refreshModel?.(live);sessions.updateRuntime(sessionId,{state:'idle'});return live;}
              catch(error){if(error instanceof DomainError&&['MODEL_NOT_FOUND','MODEL_UNAVAILABLE'].includes(error.code)){sessions.updateRuntime(sessionId,{state:'unavailable'});return null;}throw error;}
              finally{locks.delete(sessionId);}
            }
            acquireSession(sessionId);
            try{
            const input = { ...runtimeInput(value, true), projectSession: true };
            if (value.nativeRef) {
              try { return await runtime.restore(input); }
              catch(error) { if(error instanceof DomainError && ["MODEL_NOT_FOUND","MODEL_UNAVAILABLE"].includes(error.code)) { sessions.updateRuntime(sessionId,{state:"unavailable"}); return null; } throw error; }
            }
            if (!runtime.initializeProject) throw new DomainError("RUNTIME_ERROR", "项目初始化不可用", 503, true);
            return await runtime.initializeProject(input, ref => {
              const updated = sessions.setNativeRefIfAbsent(sessionId, ref);
              if (!updated?.nativeRef) throw new DomainError("NO_NATIVE_REF", "无法保存原生 Session 身份", 409, true);
              return updated.nativeRef;
            });
            }finally{locks.delete(sessionId);}
          })().finally(() => openings.delete(sessionId));
          openings.set(sessionId, opening);
        }
        const handle = await opening;
        if (handle) observe(sessionId, handle);
        const openedSession=session(sessionId);dependencies.openHistory?.record({scope:'project',ownerId:openedSession.projectId,sessionId});
        const leaseId = crypto.randomUUID(); leases.set(leaseId, { sessionId, expires: Date.now() + 120_000 }); schedule(sessionId);
        return { leaseId, status: !handle ? "unavailable" : controls.has(sessionId) || handle && runtime.isBusy?.(handle) ? "running" : "ready", outcome: lastTimeouts.has(sessionId) ? "SESSION_BACKGROUND_TIMEOUT" : null };
      })();
      idempotency.set(scopedKey, { sessionId, promise, expires: now + 600_000 });
      try { return await promise; } catch (error) { idempotency.delete(scopedKey); schedule(sessionId); throw error; }
    },
    events,
    accept(sessionId: string, instruction: string, references?: unknown, onSettled?: (error?: unknown) => void, webSearch = false, toolSearch = false) {
      const source = this.send(sessionId, instruction, undefined, references, webSearch, toolSearch);
      void (async () => {
        let failure:unknown;
        for await (const event of source) {
          if(event.type === "error") failure = new DomainError(event.code,event.message,409,true);
          if (!["pi_event","entry_link","complete","error"].includes(event.type)) events.agent(sessionId, event);
        }
        onSettled?.(failure);
        events.agent(sessionId, failure instanceof DomainError ? {type:"error",code:failure.code,message:failure.message,recoverable:true} : {type:"complete"});
      })().catch(error => { onSettled?.(error); events.agent(sessionId, { type: "error", code: "STREAM_ERROR", message: "无法完成会话事件同步，请重新读取历史", recoverable: true }); });
      return { accepted: true, sessionId };
    },
    heartbeat(sessionId: string, leaseId: string) {
      const lease = leases.get(leaseId);
      if (!lease || lease.sessionId !== sessionId || lease.expires <= Date.now()) throw new DomainError("RUNTIME_LEASE_EXPIRED", "会话使用权已过期", 409, true);
      lease.expires = Date.now() + 120_000; schedule(sessionId);
    },
    closeLease(sessionId: string, leaseId: string) { if (leases.get(leaseId)?.sessionId === sessionId) { leases.delete(leaseId); schedule(sessionId); } },
    assertLease,
    send(sessionId: string, instruction: string, operation?: "read" | "project_write" | "external_write", references?: unknown, webSearch = false, toolSearch = false): AsyncGenerator<AgentEvent> {
      const value = session(sessionId);
      operation ??= 'project_write';
      if (locks.has(sessionId) || ["starting", "running", "interrupting"].includes(value.state)) {
        throw new DomainError("SESSION_BUSY", "项目工作线正在运行", 409, true);
      }
      if (value.state === "unavailable") throw new DomainError("SESSION_RESTORE_REQUIRED", "项目工作线需要先恢复", 409, true);

      if (!runtime.getHandle(sessionId)) throw new DomainError("RUNTIME_NOT_OPEN", "请先打开项目会话", 409, true);
      const referenceContent = parseMessageReferences(references, new Set([value.projectId]), dependencies.resolveProjectReference);
      acquireSession(sessionId);
      lastTimeouts.delete(sessionId);
      const timing = createProjectMessageTiming(sessionId);
      timing("accepted");
      let complete!: () => void;
      const control = {
        cancelRequested: false,
        handle: undefined as object | undefined,
        interruptPromise: undefined as Promise<void> | undefined,
        done: new Promise<void>((resolve) => { complete = resolve; }),
        complete: () => complete(),
      };
      controls.set(sessionId, control);
      return (async function* (): AsyncGenerator<AgentEvent> {
        let runtimeStarted = false;
        let writeRoot:string|null=null;
        try {
          const input = { ...runtimeInput(value, operation === "project_write"), projectSession: true };
          if(operation==='project_write'){acquireProjectWrite(input.workingDirectory);writeRoot=input.workingDirectory;}
          sessions.updateRuntime(sessionId, { state: "starting" });
          runtimeStarted = true;
          yield { type: "session_state", state: "starting" };
          const handle = runtime.getHandle(sessionId);
          if (!handle) throw new DomainError("RUNTIME_NOT_OPEN", "请先打开项目会话", 409, true);
          timing("handle_reused");
          control.handle = handle;
          if (control.cancelRequested) {
            timing("cancelled");
            sessions.updateRuntime(sessionId, { state: "idle" });
            yield { type: "session_state", state: "idle" };
            yield { type: "error", code: "REQUEST_ABORTED", message: "请求已停止", recoverable: true };
            return;
          }
          sessions.updateRuntime(sessionId, { state: "running" });
          yield { type: "session_state", state: "running" };
          const queue = new EventQueue();
          timing("prompt_start");
          void runtime
            .send(handle, instruction, (event) => {
              if (event.type === "message_delta" && event.text) timing("first_text");
              if (event.type === "activity" && event.kind === "tool") timing("first_tool");
              queue.push(event);
            }, () => timing("assistant_stream"), referenceContent, operation === "project_write", webSearch, toolSearch)
            .then(() => {
              timing("completed");
              sessions.updateRuntime(sessionId, { state: "idle" });
              queue.push({ type: "session_state", state: "idle" });
              queue.push({ type: "complete" });
            })
            .catch((error) => {
              const cancelled = error instanceof DomainError && error.code === "REQUEST_ABORTED";
              timing(cancelled ? "cancelled" : "failed");
              sessions.updateRuntime(sessionId, { state: cancelled ? "idle" : "unavailable" });
              if (cancelled) queue.push({ type: "session_state", state: "idle" });
              const timeout = cancelled && timeouts.delete(sessionId);
              if (timeout) lastTimeouts.add(sessionId);
              queue.push({ type: "error", code: timeout ? "SESSION_BACKGROUND_TIMEOUT" : error instanceof DomainError ? error.code : "RUNTIME_ERROR", message: timeout ? "会话离开后运行超时并已停止" : error instanceof DomainError ? error.message : "Pi Runtime 执行失败", recoverable: true });
            })
            .finally(() => queue.end());
          while (true) {
            const event = await queue.next();
            if (!event) break;
            yield event;
          }
        } catch (error) {
          const cancelled = error instanceof DomainError && error.code === "REQUEST_ABORTED";
          timing(cancelled ? "cancelled" : "failed");
          if (runtimeStarted) sessions.updateRuntime(sessionId, { state: cancelled ? "idle" : "unavailable" });
          yield {
            type: "error",
            code: error instanceof DomainError ? error.code : "RUNTIME_ERROR",
            message: error instanceof DomainError ? error.message : "Pi Runtime 执行失败",
            recoverable: error instanceof DomainError ? error.recoverable : true,
          };
        } finally {
          timeouts.delete(sessionId);
          if (controls.get(sessionId) === control) controls.delete(sessionId);
          locks.delete(sessionId);
          if(writeRoot)projectWriteRoots.delete(writeRoot);
          control.complete();
          if (!hasLease(sessionId)) schedule(sessionId);
        }
      })();
    },
    async interrupt(sessionId: string) {
      const value = session(sessionId);
      if (!["starting", "running", "interrupting"].includes(value.state)) {
        throw new DomainError("SESSION_NOT_RUNNING", "项目工作线当前没有运行任务", 409, true);
      }
      const control = controls.get(sessionId);
      if (!control) {
        sessions.updateRuntime(sessionId, { state: "unavailable" });
        throw new DomainError("SESSION_RUNTIME_UNAVAILABLE", "运行中的项目工作线没有可控制的运行时，请先恢复会话", 409, true);
      }
      control.cancelRequested = true;
      sessions.updateRuntime(sessionId, { state: "interrupting" });
      const handle = control.handle ?? runtime.getHandle(sessionId);
      if (handle && !control.interruptPromise) control.interruptPromise = runtime.interrupt(handle);
      if (control.interruptPromise) await control.interruptPromise;
      await control.done;
    },
    async restore(sessionId: string) {
      if(locks.has(sessionId))throw new DomainError("SESSION_BUSY","Session 正在回答或压缩",409,true);
      const value = session(sessionId);
      if (value.state !== "unavailable") throw new DomainError("SESSION_NOT_UNAVAILABLE", "只有不可用的项目工作线需要恢复", 409, true);
      if (!value.nativeRef) throw new DomainError("NO_NATIVE_REF", "项目工作线没有可恢复的 Pi Session", 409, true);
      acquireSession(sessionId);
      try{const previous=runtime.getHandle(sessionId);if(previous)await runtime.close(previous);const handle=await runtime.restore({...runtimeInput(value,true),projectSession:true});observe(sessionId,handle);return sessions.updateRuntime(sessionId,{state:'idle'})!;}finally{locks.delete(sessionId);}
    },
    async messages(sessionId: string) {
      const value = session(sessionId);
      const project = projects.get(value.projectId);
      if (!project) throw new DomainError("NOT_FOUND", "项目不存在", 404, true);
      if (!runtime.readTree) throw new DomainError("SESSION_TREE_READ_FAILED", "原生树读取不可用", 500, true);
      return runtime.readTree({session:value,workingDirectory:project.rootPath,allowProjectWrite:false,projectSession:true});
    },
    async deleteSession(projectId: string, sessionId: string) {
      const value = session(sessionId);
      if (value.projectId !== projectId) throw new DomainError('NOT_FOUND', '项目会话不存在', 404, true);
      if (openings.has(sessionId) || controls.has(sessionId) || ['starting','running','interrupting'].includes(value.state)) throw new DomainError('SESSION_BUSY', '请等待会话操作结束后删除', 409, true);
      if (value.state === 'unavailable') throw new DomainError('REQUEST_UNKNOWN', '请先核对并恢复会话', 409, true);
      acquireSession(sessionId);
      deleting.add(sessionId);
      try {
        const handle = runtime.getHandle(sessionId);
        if (handle && runtime.isBusy?.(handle)) throw new DomainError('SESSION_BUSY', '会话正在运行', 409, true);
        if (handle) await runtime.close(handle);
        sessions.delete(projectId, sessionId);
        events.closeSession(sessionId);observed.get(sessionId)?.unsubscribe(); observed.delete(sessionId); clearTimer(sessionId);
        for (const [key, lease] of leases) if (lease.sessionId === sessionId) leases.delete(key);
        for (const [key, record] of idempotency) if (record.sessionId === sessionId) idempotency.delete(key);
        timeouts.delete(sessionId); lastTimeouts.delete(sessionId);
        return { deleted: true, sessionId };
      } finally { deleting.delete(sessionId); locks.delete(sessionId); }
    },
    async close(sessionId: string) {
      if(openings.has(sessionId) || locks.has(sessionId))throw new DomainError("SESSION_BUSY","Session 正在打开、回答或压缩",409,true);
      acquireSession(sessionId);closing.add(sessionId);
      try {
        const handle = runtime.getHandle(sessionId);
        if (handle) await runtime.close(handle);
        events.closeSession(sessionId);
        for(const [key,lease] of leases)if(lease.sessionId===sessionId)leases.delete(key);
        for(const [key,record] of idempotency)if(record.sessionId===sessionId)idempotency.delete(key);
        clearTimer(sessionId);observed.get(sessionId)?.unsubscribe();observed.delete(sessionId);
      } finally {closing.delete(sessionId);locks.delete(sessionId);}
    },
  };
}
