import { DomainError, enumValue, requiredText } from "@/domain/errors";
import type {
  RoomContentRepositoryPort,
  RoomRepositoryPort,
  SessionRepositoryPort,
  WorkspaceRepositoryPort,
} from "@/application/ports/core";

const roomStatuses = ["active", "paused", "closed", "archived"] as const;

const allowedTransitions: Record<(typeof roomStatuses)[number], Set<(typeof roomStatuses)[number]>> = {
  active: new Set(["active", "paused", "closed", "archived"]),
  paused: new Set(["active", "paused", "closed", "archived"]),
  closed: new Set(["active", "closed", "archived"]),
  archived: new Set(["active", "archived"]),
};

export function createRoomService(dependencies: {
  workspaces: WorkspaceRepositoryPort;
  rooms: RoomRepositoryPort;
  sessions: SessionRepositoryPort;
  contents: RoomContentRepositoryPort;
}) {
  const { workspaces, rooms, sessions, contents } = dependencies;
  return {
    list(workspaceId: string) {
      const workspace = workspaces.get(workspaceId);
      if (!workspace) throw new DomainError("NOT_FOUND", "工作空间不存在", 404, true);
      return rooms.list(workspaceId);
    },
    get(id: string) {
      const room = rooms.get(id);
      if (!room) throw new DomainError("NOT_FOUND", "会话不存在", 404, true);
      return room;
    },
    view(id: string) {
      const room = this.get(id);
      return {
        room,
        sessions: sessions.listForRoom(id),
        contents: contents.list(id),
      };
    },
    create(workspaceId: string) {
      const workspace = workspaces.get(workspaceId);
      if (!workspace) throw new DomainError("NOT_FOUND", "工作空间不存在", 404, true);
      if (workspace.status !== "active") {
        throw new DomainError("WORKSPACE_ARCHIVED", "归档工作空间不能创建会话", 409, true);
      }
      return rooms.create(workspaceId);
    },
    update(id: string, body: Record<string, unknown>) {
      const room = this.get(id);
      let status = room.status;
      if (body.status !== undefined) {
        status = enumValue(body.status, roomStatuses, "status");
        if (!allowedTransitions[room.status].has(status)) {
          throw new DomainError("INVALID_ROOM_TRANSITION", "会话状态转换无效", 409, true);
        }
      }
      return rooms.update(id, {
        ...(body.title !== undefined
          ? { title: requiredText(body.title, "title", "会话标题") }
          : {}),
        status,
      })!;
    },
    delete(id: string) {
      if (!rooms.delete(id)) throw new DomainError("NOT_FOUND", "会话不存在", 404, true);
    },
  };
}
