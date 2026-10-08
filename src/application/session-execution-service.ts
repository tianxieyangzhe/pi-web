import { DomainError } from "@/domain/errors";
import type { AgentEvent, Session } from "@/domain/models";
import type { SessionCatalogPort, SessionRepositoryPort } from "@/application/ports/core";
import type { ProjectRepositoryPort } from "@/application/ports/catalog";
import type { PiRuntimePort, SessionRuntimeInput } from "@/application/ports/pi-runtime";

import { sessionLocks as locks, acquireSession } from "./session-lock";
import type { SessionMemoryRepositoryPort } from "./ports/session-memory";

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
  runtime: PiRuntimePort;
  sessionMemories: SessionMemoryRepositoryPort;
  onCompleted?: (sessionId: string) => void;
}) {
  const { sessions, catalog, projects, runtime } = dependencies;

  function session(id: string): Session {
    const value = sessions.get(id);
    if (!value) throw new DomainError("NOT_FOUND", "项目工作线不存在", 404, true);
    return value;
  }

  function runtimeInput(value: Session, allowProjectWrite = false): SessionRuntimeInput {
    const project = projects.get(value.projectId);
    if (!project || project.status !== "active") {
      throw new DomainError("PROJECT_UNAVAILABLE", "项目不存在或当前不可用", 409, true);
    }
    if (value.agentId && catalog.getAgent(value.agentId)?.status !== "active") {
      throw new DomainError("AGENT_UNAVAILABLE", "当前 Agent 已不可用", 409, true);
    }
    if (value.agentSnapshot?.extension.extensionSources.length) {
      throw new DomainError("AGENT_EXTENSION_UNAVAILABLE", "当前安全执行层尚未开放 Agent 扩展脚本", 503, true);
    }
    for (const id of value.mcpIds) {
      if (catalog.getMcp(id)?.status !== "active") {
        throw new DomainError("MCP_UNAVAILABLE", `MCP ${id} 已不可用`, 409, true);
      }
    }
    if (value.mcpIds.length > 0) {
      throw new DomainError("MCP_RUNTIME_UNAVAILABLE", "MCP 客户端尚未安装", 503, true);
    }
    return {
      session: value,
      workingDirectory: project.rootPath,
      allowProjectWrite: allowProjectWrite && (value.agentSnapshot?.policy.allowProjectWrite ?? true),
    };
  }

  return {
    send(sessionId: string, instruction: string, operation: "read" | "project_write" | "external_write" = "read"): AsyncGenerator<AgentEvent> {
      const value = session(sessionId);
      const memory = value.sessionMemoryId ? dependencies.sessionMemories.get(value.sessionMemoryId) : null;
      if (!memory || memory.projectId !== value.projectId) {
        throw new DomainError("MEMORY_NOT_ACTIVE", "当前会话不能执行项目任务", 409, true);
      }
      if (locks.has(sessionId) || ["starting", "running", "interrupting"].includes(value.state)) {
        throw new DomainError("SESSION_BUSY", "项目工作线正在运行", 409, true);
      }
      if (value.state === "ended") throw new DomainError("SESSION_ENDED", "项目工作线已结束", 409, true);
      if (value.state === "unavailable") throw new DomainError("SESSION_RESTORE_REQUIRED", "项目工作线需要先恢复", 409, true);

      acquireSession(sessionId);
      return (async function* (): AsyncGenerator<AgentEvent> {
        let runtimeStarted = false;
        try {
          const input = { ...runtimeInput(value, operation === "project_write"), projectSession: true };
          sessions.updateRuntime(sessionId, { state: "starting" });
          runtimeStarted = true;
          yield { type: "session_state", state: "starting" };
          const current = session(sessionId);
          const currentInput = { ...input, session: current };
          let handle = runtime.getHandle(sessionId, currentInput);
          if (!handle && current.nativeRef) handle = await runtime.restore(currentInput);
          else if (!handle) {
            const opened = await runtime.open(currentInput);
            handle = opened.handle;
            sessions.updateRuntime(sessionId, { nativeRef: opened.nativeRef });
          }
          sessions.updateRuntime(sessionId, { state: "running" });
          yield { type: "session_state", state: "running" };
          const queue = new EventQueue();
          void runtime
            .send(handle, instruction, (event) => {
              queue.push(event);
            })
            .then(() => {
              sessions.updateRuntime(sessionId, { state: "idle" });
              queue.push({ type: "session_state", state: "idle" });
              queue.push({ type: "complete" });
              setTimeout(() => dependencies.onCompleted?.(sessionId), 0);
            })
            .catch((error) => {
              sessions.updateRuntime(sessionId, { state: "unavailable" });
              queue.push({ type: "error", code: error instanceof DomainError ? error.code : "RUNTIME_ERROR", message: error instanceof DomainError ? error.message : "Pi Runtime 执行失败", recoverable: true });
            })
            .finally(() => queue.end());
          while (true) {
            const event = await queue.next();
            if (!event) break;
            yield event;
          }
        } catch (error) {
          if (runtimeStarted) sessions.updateRuntime(sessionId, { state: "unavailable" });
          yield {
            type: "error",
            code: error instanceof DomainError ? error.code : "RUNTIME_ERROR",
            message: error instanceof DomainError ? error.message : "Pi Runtime 执行失败",
            recoverable: error instanceof DomainError ? error.recoverable : true,
          };
        } finally {
          locks.delete(sessionId);
        }
      })();
    },
    async interrupt(sessionId: string) {
      const value = session(sessionId);
      if (!["starting", "running", "interrupting"].includes(value.state)) {
        throw new DomainError("SESSION_NOT_RUNNING", "项目工作线当前没有运行任务", 409, true);
      }
      const handle = runtime.getHandle(sessionId);
      if (!handle) {
        sessions.updateRuntime(sessionId, { state: "unavailable" });
        return;
      }
      sessions.updateRuntime(sessionId, { state: "interrupting" });
      await runtime.interrupt(handle);
      sessions.updateRuntime(sessionId, { state: "idle" });
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
      return value.nativeRef ? runtime.readMessages(runtimeInput(value)) : [];
    },
    async close(sessionId: string) {
      if(locks.has(sessionId))throw new DomainError("SESSION_BUSY","Session 正在回答或压缩",409,true);
      const handle = runtime.getHandle(sessionId);
      if (handle) await runtime.close(handle);
    },
  };
}
