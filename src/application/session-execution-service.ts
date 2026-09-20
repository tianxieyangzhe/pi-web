import { DomainError } from "@/domain/errors";
import type { AgentEvent, Session } from "@/domain/models";
import type {
  RoomRepositoryPort,
  SessionCatalogPort,
  SessionRepositoryPort,
} from "@/application/ports/core";
import type { ProjectRepositoryPort } from "@/application/ports/catalog";
import type { PiRuntimePort, SessionRuntimeInput } from "@/application/ports/pi-runtime";

const locks = new Set<string>();

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
  rooms: RoomRepositoryPort;
  catalog: SessionCatalogPort;
  projects: ProjectRepositoryPort;
  runtime: PiRuntimePort;
}) {
  const { sessions, rooms, catalog, projects, runtime } = dependencies;

  function session(id: string): Session {
    const value = sessions.get(id);
    if (!value) throw new DomainError("NOT_FOUND", "工作线不存在", 404, true);
    return value;
  }

  function runtimeInput(value: Session): SessionRuntimeInput {
    if (value.agentId && catalog.getAgent(value.agentId)?.status !== "active") {
      throw new DomainError("AGENT_UNAVAILABLE", "当前 Agent 已不可用，请重新配置工作线", 409, true);
    }
    if (value.agentSnapshot?.extension.extensionSources.length) {
      throw new DomainError(
        "AGENT_EXTENSION_UNAVAILABLE",
        "当前安全执行层尚未开放 Agent 扩展脚本，请移除 extensionSources 后重试",
        503,
        true,
      );
    }
    for (const id of value.mcpIds) {
      if (catalog.getMcp(id)?.status !== "active") {
        throw new DomainError("MCP_UNAVAILABLE", `MCP ${id} 已不可用，请重新配置工作线`, 409, true);
      }
    }
    const project = value.workingProjectId ? projects.get(value.workingProjectId) : null;
    if (value.workingProjectId && (!project || project.status !== "active")) {
      throw new DomainError("PROJECT_UNAVAILABLE", "工作项目不存在或当前不可用", 409, true);
    }
    if (value.mcpIds.length > 0) {
      throw new DomainError(
        "MCP_RUNTIME_UNAVAILABLE",
        "MCP 客户端尚未安装，当前工作线不能加载已配置的 MCP",
        503,
        true,
      );
    }
    const referenceDirectories = value.referenceProjectIds.map((id) => {
      const reference = projects.get(id);
      if (!reference || reference.status !== "active") {
        throw new DomainError("PROJECT_UNAVAILABLE", `参考项目 ${id} 不存在或当前不可用`, 409, true);
      }
      return reference.rootPath;
    });
    const policy = value.agentSnapshot?.policy;
    return {
      session: value,
      workingDirectory: project?.rootPath ?? process.cwd(),
      referenceDirectories,
      hasWorkingProject: Boolean(project),
      allowProjectWrite:
        Boolean(project) &&
        project?.accessMode === "write" &&
        (value.agentSnapshot?.policy.allowProjectWrite ?? true),
      ...(policy?.allowDelegation
        ? {
            delegateSession: async (purpose: string) => {
              if (rooms.get(value.roomId)?.status !== "active") {
                throw new DomainError("ROOM_NOT_ACTIVE", "当前会话不能创建辅助工作线", 409, true);
              }
              const children = sessions.listForRoom(value.roomId).filter(
                (item) => item.parentSessionId === value.id && item.state !== "ended",
              );
              if (children.length >= policy.maxParallelSessions) {
                throw new DomainError(
                  "DELEGATION_LIMIT",
                  `当前工作线最多保留 ${policy.maxParallelSessions} 条未结束的委派工作线`,
                  409,
                  true,
                );
              }
              return sessions.create({
                workspaceId: value.workspaceId,
                roomId: value.roomId,
                role: "worker",
                purpose,
                parentSessionId: value.id,
                agentId: value.agentId,
                agentSnapshot: value.agentSnapshot,
                mcpIds: value.mcpIds,
                mcpSnapshots: value.mcpSnapshots,
                workingProjectId: value.workingProjectId,
                referenceProjectIds: value.referenceProjectIds,
              });
            },
          }
        : {}),
    };
  }

  return {
    send(sessionId: string, message: string): AsyncGenerator<AgentEvent> {
      const value = session(sessionId);
      const room = rooms.get(value.roomId);
      if (!room || room.status !== "active") {
        throw new DomainError("ROOM_NOT_ACTIVE", "当前会话不能发送消息", 409, true);
      }
      if (locks.has(sessionId)) {
        throw new DomainError("SESSION_BUSY", "工作线正在运行", 409, true);
      }
      if (value.state === "ended") {
        throw new DomainError("SESSION_ENDED", "工作线已结束", 409, true);
      }
      if (value.state === "unavailable") {
        throw new DomainError("SESSION_RESTORE_REQUIRED", "工作线需要先恢复", 409, true);
      }
      if (["starting", "running", "interrupting"].includes(value.state)) {
        throw new DomainError("SESSION_BUSY", "工作线正在运行", 409, true);
      }
      locks.add(sessionId);
      return (async function* (): AsyncGenerator<AgentEvent> {
        let handle: object | undefined;
        let runtimeStarted = false;
        try {
          const input = runtimeInput(value);
          sessions.updateRuntime(sessionId, { state: "starting" });
          runtimeStarted = true;
          yield { type: "session_state", state: "starting" };
          const latest = session(sessionId);
          const latestInput = { ...input, session: latest };
          handle = runtime.getHandle(sessionId, latestInput);
          if (!handle && latest.nativeRef) {
            handle = await runtime.restore(latestInput);
          } else if (!handle) {
            const opened = await runtime.open(latestInput);
            handle = opened.handle;
            sessions.updateRuntime(sessionId, { nativeRef: opened.nativeRef });
          }
          if (session(sessionId).state === "unavailable") {
            yield { type: "error", code: "INTERRUPTED", message: "工作线已被中断", recoverable: true };
            return;
          }
          sessions.updateRuntime(sessionId, { state: "running" });
          yield { type: "session_state", state: "running" };
          const queue = new EventQueue();
          void runtime
            .send(handle, message, (event) => queue.push(event))
            .then(() => {
              sessions.updateRuntime(sessionId, { state: "idle" });
              queue.push({ type: "session_state", state: "idle" });
              queue.push({ type: "complete" });
            })
            .catch((error: unknown) => {
              sessions.updateRuntime(sessionId, { state: "unavailable" });
              queue.push({
                type: "error",
                code: "RUNTIME_ERROR",
                message: "Pi Runtime 执行失败",
                recoverable: true,
              });
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
        throw new DomainError("SESSION_NOT_RUNNING", "工作线当前没有运行中的任务", 409, true);
      }
      const handle = runtime.getHandle(sessionId);
      if (!handle) {
        if (value.state === "running" || value.state === "starting") {
          sessions.updateRuntime(sessionId, { state: "unavailable" });
        }
        return;
      }
      sessions.updateRuntime(sessionId, { state: "interrupting" });
      await runtime.interrupt(handle);
      sessions.updateRuntime(sessionId, { state: "idle" });
    },
    async restore(sessionId: string) {
      const value = session(sessionId);
      if (value.state !== "unavailable") {
        throw new DomainError("SESSION_NOT_UNAVAILABLE", "只有不可用的工作线需要恢复", 409, true);
      }
      if (!value.nativeRef) throw new DomainError("NO_NATIVE_REF", "工作线没有可恢复的 Pi Session", 409, true);
      const handle = await runtime.restore(runtimeInput(value));
      sessions.updateRuntime(sessionId, { state: "idle" });
      return handle;
    },
    async messages(sessionId: string) {
      const value = session(sessionId);
      if (!value.nativeRef) return [];
      return runtime.readMessages(runtimeInput(value));
    },
    async close(sessionId: string) {
      const value = session(sessionId);
      const handle = runtime.getHandle(sessionId);
      if (handle) await runtime.close(handle);
    },
  };
}
