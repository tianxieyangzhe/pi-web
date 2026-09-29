import { DomainError, enumValue, optionalText, requiredText, uniqueStrings } from "@/domain/errors";
import type { RoomContentRepositoryPort, RoomRepositoryPort, RoomRunRepositoryPort, SessionRepositoryPort, TaskRepositoryPort } from "@/application/ports/core";
import type { ProjectRepositoryPort } from "@/application/ports/catalog";

const roomKinds = ["cross_project"] as const;
const roomStatuses = ["active", "paused", "closed", "archived"] as const;
const allowedTransitions: Record<(typeof roomStatuses)[number], Set<(typeof roomStatuses)[number]>> = {
  active: new Set(roomStatuses), paused: new Set(roomStatuses),
  closed: new Set(["active", "closed", "archived"]), archived: new Set(["active", "archived"]),
};

export function createRoomService(dependencies: {
  rooms: RoomRepositoryPort;
  projects: ProjectRepositoryPort;
  runs: RoomRunRepositoryPort;
  tasks: TaskRepositoryPort;
  sessions: SessionRepositoryPort;
  contents: RoomContentRepositoryPort;
}) {
  const { rooms, projects, runs, tasks, sessions, contents } = dependencies;
  return {
    list(projectId?: string | null) {
      if (!projectId) return rooms.list();
      if (!projects.get(projectId)) throw new DomainError("NOT_FOUND", "项目不存在", 404, true);
      return rooms.listForProject(projectId);
    },
    get(id: string) {
      const room = rooms.get(id);
      if (!room) throw new DomainError("NOT_FOUND", "会话不存在", 404, true);
      return room;
    },
    view(id: string) {
      const room = this.get(id);
      const scope = rooms.listProjects(id);
      return {
        room,
        scope,
        projects: scope.map((item) => projects.get(item.projectId)).filter((item) => item !== null),
        runs: runs.listForRoom(id), tasks: tasks.listForRoom(id),
        sessions: sessions.listForRoom(id), contents: contents.list(id),
      };
    },
    create(body: Record<string, unknown>) {
      const kind = enumValue(body.kind, roomKinds, "kind");
      const projectIds = uniqueStrings(body.projectIds, "projectIds");
      if (projectIds.length < 2) throw new DomainError("INVALID_ROOM_SCOPE", "跨项目会话至少选择两个项目", 422, true);
      for (const id of projectIds) {
        const project = projects.get(id);
        if (!project || project.status !== "active") throw new DomainError("PROJECT_UNAVAILABLE", "所选项目不可用", 422, true);
      }
      const defaultTitle = projectIds.map((id) => projects.get(id)!.name).join(" + ");
      return rooms.create({ kind, projectIds, title: optionalText(body.title) ?? defaultTitle });
    },
    update(id: string, body: Record<string, unknown>) {
      const room = this.get(id);
      const status = body.status === undefined ? room.status : enumValue(body.status, roomStatuses, "status");
      if (!allowedTransitions[room.status].has(status)) throw new DomainError("INVALID_ROOM_TRANSITION", "会话状态转换无效", 409, true);
      return rooms.update(id, {
        ...(body.title === undefined ? {} : { title: requiredText(body.title, "title", "会话标题") }), status,
      })!;
    },
    delete(id: string) {
      if (!rooms.delete(id)) throw new DomainError("NOT_FOUND", "会话不存在", 404, true);
    },
  };
}
