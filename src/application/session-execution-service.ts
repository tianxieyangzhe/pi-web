import {boundRole, isRoleSnapshot} from "@/domain/agent-definition";
import { DomainError } from "@/domain/errors";
import type { AgentEvent, Session } from "@/domain/models";
import type { SessionCatalogPort, SessionRepositoryPort } from "@/application/ports/core";
import type { ProjectRepositoryPort } from "@/application/ports/catalog";
import type { PiRuntimePort, SessionRuntimeInput } from "@/application/ports/pi-runtime";

import { sessionLocks as locks, acquireSession,acquireProjectWrite,projectWriteRoots } from "./session-lock";
import type { SessionMemoryRepositoryPort } from "./ports/session-memory";
import { createProjectMessageTiming } from "./project-message-timing";
import { parseMessageReferences, type ProjectMessageReference } from "@/domain/message-references";

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
  readProjectReference?: (reference: ProjectMessageReference) => { name: string; data: string };
  runtime: PiRuntimePort;
  sessionMemories: SessionMemoryRepositoryPort;
  onCompleted?: (sessionId: string) => void;
  assertSessionAllowed?: (sessionId:string)=>void;
  coordinatorExecutionIds?: (sessionId:string)=>ReadonlySet<string>;
}) {
  const { sessions, catalog, projects, runtime } = dependencies;
  const controls = new Map<string, {
    cancelRequested: boolean;
    handle?: object;
    interruptPromise?: Promise<void>;
    done: Promise<void>;
    complete: () => void;
  }>();

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
      independentProjectTools: true,
      workingDirectory: project.rootPath,
      allowProjectWrite,
    };
  }

  return {
    referenceContractVersion: 6,
    send(sessionId: string, instruction: string, operation?: "read" | "project_write" | "external_write", references?: unknown): AsyncGenerator<AgentEvent> {
      const value = session(sessionId);
      operation ??= 'project_write';
      dependencies.assertSessionAllowed?.(sessionId);
      const memory = value.sessionMemoryId ? dependencies.sessionMemories.get(value.sessionMemoryId) : null;
      if (!memory || memory.projectId !== value.projectId) {
        throw new DomainError("MEMORY_NOT_ACTIVE", "当前会话不能执行项目任务", 409, true);
      }
      if (locks.has(sessionId) || ["starting", "running", "interrupting"].includes(value.state)) {
        throw new DomainError("SESSION_BUSY", "项目工作线正在运行", 409, true);
      }
      if (value.state === "ended") throw new DomainError("SESSION_ENDED", "项目工作线已结束", 409, true);
      if (value.state === "unavailable") throw new DomainError("SESSION_RESTORE_REQUIRED", "项目工作线需要先恢复", 409, true);

      const referenceContent = parseMessageReferences(references, new Set([value.projectId]), dependencies.readProjectReference);
      acquireSession(sessionId);
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
          const current = session(sessionId);
          const currentInput = { ...input, session: { ...current, agentSnapshot: input.session.agentSnapshot } };
          let handle = runtime.getHandle(sessionId, currentInput);
          if (handle) timing("handle_reused");
          else if (current.nativeRef) {
            handle = await runtime.restore(currentInput);
            timing("handle_restored");
          } else {
            const opened = await runtime.open(currentInput);
            handle = opened.handle;
            control.handle = handle;
            sessions.updateRuntime(sessionId, { nativeRef: opened.nativeRef });
            timing("handle_opened");
          }
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
            }, () => timing("assistant_stream"), referenceContent)
            .then(() => {
              timing("completed");
              sessions.updateRuntime(sessionId, { state: "idle" });
              queue.push({ type: "session_state", state: "idle" });
              queue.push({ type: "complete" });
              setTimeout(() => dependencies.onCompleted?.(sessionId), 0);
            })
            .catch((error) => {
              const cancelled = error instanceof DomainError && error.code === "REQUEST_ABORTED";
              timing(cancelled ? "cancelled" : "failed");
              sessions.updateRuntime(sessionId, { state: cancelled ? "idle" : "unavailable" });
              if (cancelled) queue.push({ type: "session_state", state: "idle" });
              queue.push({ type: "error", code: error instanceof DomainError ? error.code : "RUNTIME_ERROR", message: error instanceof DomainError ? error.message : "Pi Runtime 执行失败", recoverable: true });
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
          if (controls.get(sessionId) === control) controls.delete(sessionId);
          locks.delete(sessionId);
          if(writeRoot)projectWriteRoots.delete(writeRoot);
          control.complete();
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
      await runtime.restore(runtimeInput(value));
      return sessions.updateRuntime(sessionId, { state: "idle" })!;
    },
    async messages(sessionId: string) {
      const value = session(sessionId);
      return value.nativeRef ? runtime.readMessages({session:value,workingDirectory:projects.get(value.projectId)!.rootPath,allowProjectWrite:false,allowProjectRead:false,projectSession:true,coordinatorExecutionIds:dependencies.coordinatorExecutionIds?.(sessionId)}) : [];
    },
    async close(sessionId: string) {
      if(locks.has(sessionId))throw new DomainError("SESSION_BUSY","Session 正在回答或压缩",409,true);
      const handle = runtime.getHandle(sessionId);
      if (handle) await runtime.close(handle);
    },
  };
}
