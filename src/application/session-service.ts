import {
  DomainError,
  enumValue,
  optionalText,
  uniqueStrings,
} from "@/domain/errors";
import type { Session } from "@/domain/models";
import type {
  RoomRepositoryPort,
  SessionCatalogPort,
  SessionRepositoryPort,
} from "@/application/ports/core";

function nullableId(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", `${field}必须是字符串或 null`, 400, true);
  }
  return value;
}

export function createSessionService(dependencies: {
  rooms: RoomRepositoryPort;
  sessions: SessionRepositoryPort;
  catalog: SessionCatalogPort;
}) {
  const { rooms, sessions, catalog } = dependencies;

  function roomForSession(roomId: string) {
    const room = rooms.get(roomId);
    if (!room) throw new DomainError("NOT_FOUND", "会话不存在", 404, true);
    return room;
  }

  function sessionInRoom(roomId: string, sessionId: string): Session {
    const session = sessions.get(sessionId);
    if (!session || session.roomId !== roomId) {
      throw new DomainError("NOT_FOUND", "工作线不存在", 404, true);
    }
    return session;
  }

  function resolveConfiguration(body: Record<string, unknown>) {
    const agentId = nullableId(body.agentId, "agentId");
    const agentSnapshot = agentId ? catalog.getAgent(agentId) : null;
    if (agentId && (!agentSnapshot || agentSnapshot.status !== "active")) {
      throw new DomainError("AGENT_UNAVAILABLE", "Agent 不存在或不可用", 422, true);
    }

    const mcpIds = uniqueStrings(body.mcpIds, "mcpIds");
    const mcpSnapshots = mcpIds.map((id) => {
      const mcp = catalog.getMcp(id);
      if (!mcp || mcp.status !== "active") {
        throw new DomainError("MCP_UNAVAILABLE", `MCP ${id} 不存在或不可用`, 422, true);
      }
      return mcp;
    });

    const workingProjectId = nullableId(body.workingProjectId, "workingProjectId");
    const referenceProjectIds = uniqueStrings(
      body.referenceProjectIds,
      "referenceProjectIds",
    );
    if (workingProjectId && referenceProjectIds.includes(workingProjectId)) {
      throw new DomainError(
        "INVALID_PROJECT_BINDING",
        "工作项目不能同时作为参考项目",
        422,
        true,
      );
    }
    for (const id of [workingProjectId, ...referenceProjectIds].filter(Boolean) as string[]) {
      const project = catalog.getProject(id);
      if (!project || project.status !== "active") {
        throw new DomainError("PROJECT_UNAVAILABLE", `项目 ${id} 不存在或不可用`, 422, true);
      }
    }

    return {
      agentId,
      agentSnapshot,
      mcpIds,
      mcpSnapshots,
      workingProjectId,
      referenceProjectIds,
    };
  }

  return {
    list(roomId: string) {
      roomForSession(roomId);
      return sessions.listForRoom(roomId);
    },
    get(roomId: string, sessionId: string) {
      return sessionInRoom(roomId, sessionId);
    },
    getOrCreatePrimary(roomId: string): Session {
      const room = roomForSession(roomId);
      if (room.status !== "active") {
        throw new DomainError("ROOM_NOT_ACTIVE", "当前会话不能发送消息", 409, true);
      }
      const existing = sessions.getPrimary(roomId);
      if (existing) return existing;
      try {
        return sessions.create({
          workspaceId: room.workspaceId,
          roomId,
          role: "primary",
          purpose: null,
          parentSessionId: null,
          agentId: null,
          agentSnapshot: null,
          mcpIds: [],
          mcpSnapshots: [],
          workingProjectId: null,
          referenceProjectIds: [],
        });
      } catch (error) {
        const concurrent = sessions.getPrimary(roomId);
        if (concurrent) return concurrent;
        throw error;
      }
    },
    create(roomId: string, body: Record<string, unknown>): Session {
      const room = roomForSession(roomId);
      if (room.status !== "active") {
        throw new DomainError("ROOM_NOT_ACTIVE", "当前会话不能创建工作线", 409, true);
      }
      const role = enumValue(body.role, ["primary", "worker"] as const, "role", "worker");
      if (role !== "worker") {
        throw new DomainError("PRIMARY_LAZY_ONLY", "主工作线只能由普通消息创建", 409, true);
      }
      const purpose = optionalText(body.purpose);
      if (role === "worker" && !purpose) {
        throw new DomainError("INVALID_INPUT", "辅助工作线必须填写目的", 400, true);
      }
      const parentSessionId = nullableId(body.parentSessionId, "parentSessionId");
      if (parentSessionId) sessionInRoom(roomId, parentSessionId);
      const configuration = resolveConfiguration(body);
      return sessions.create({
        workspaceId: room.workspaceId,
        roomId,
        role,
        purpose,
        parentSessionId,
        ...configuration,
      });
    },
    configure(roomId: string, sessionId: string, body: Record<string, unknown>) {
      const current = sessionInRoom(roomId, sessionId);
      if (current.state === "ended") {
        throw new DomainError("SESSION_ENDED", "已结束的工作线不能修改配置", 409, true);
      }
      const configuration = resolveConfiguration({
        agentId: body.agentId === undefined ? current.agentId : body.agentId,
        mcpIds: body.mcpIds === undefined ? current.mcpIds : body.mcpIds,
        workingProjectId:
          body.workingProjectId === undefined
            ? current.workingProjectId
            : body.workingProjectId,
        referenceProjectIds:
          body.referenceProjectIds === undefined
            ? current.referenceProjectIds
            : body.referenceProjectIds,
      });
      return sessions.updateConfiguration(sessionId, configuration)!;
    },
    end(roomId: string, sessionId: string) {
      const session = sessionInRoom(roomId, sessionId);
      if (["starting", "running", "interrupting"].includes(session.state)) {
        throw new DomainError("SESSION_RUNNING", "请先停止工作线", 409, true);
      }
      return sessions.updateRuntime(sessionId, {
        state: "ended",
        endedAt: new Date().toISOString(),
      })!;
    },
  };
}
