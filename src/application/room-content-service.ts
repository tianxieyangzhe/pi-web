import { DomainError, enumValue, optionalText, requiredText } from "@/domain/errors";
import type { RoomContent, RoomContentKind, RoomContentStatus } from "@/domain/models";
import type {
  RoomContentRepositoryPort,
  RoomRepositoryPort,
  RoomRunRepositoryPort,
  SessionRepositoryPort,
  TaskRepositoryPort,
} from "@/application/ports/core";

const kinds = ["overview", "goal", "rule", "memory", "direction", "decision", "output"] as const;
const outputKinds = ["note", "plan", "delivery", "summary"] as const;
const statusesByKind: Record<RoomContentKind, readonly RoomContentStatus[]> = {
  overview: ["active", "superseded"],
  goal: ["candidate", "active", "dismissed", "superseded", "retracted"],
  rule: ["candidate", "active", "dismissed", "superseded", "retracted"],
  memory: ["candidate", "active", "dismissed", "superseded", "retracted"],
  direction: ["candidate", "adopted", "dismissed", "superseded", "retracted"],
  decision: ["candidate", "adopted", "dismissed", "superseded", "retracted"],
  output: ["draft", "published", "superseded", "retracted"],
};

function defaultStatus(kind: RoomContentKind): RoomContentStatus {
  if (kind === "overview") return "active";
  if (kind === "output") return "draft";
  return "candidate";
}

export function createRoomContentService(dependencies: {
  rooms: RoomRepositoryPort;
  runs: RoomRunRepositoryPort;
  tasks: TaskRepositoryPort;
  sessions: SessionRepositoryPort;
  contents: RoomContentRepositoryPort;
}) {
  const { rooms, runs, tasks, sessions, contents } = dependencies;

  function writableRoom(roomId: string) {
    const room = rooms.get(roomId);
    if (!room) throw new DomainError("NOT_FOUND", "会话不存在", 404, true);
    if (room.status === "archived") throw new DomainError("ROOM_ARCHIVED", "归档会话不能修改内容", 409, true);
    return room;
  }

  function source(roomId: string, body: Record<string, unknown>) {
    const runId = optionalText(body.sourceRunId);
    const taskId = optionalText(body.sourceTaskId);
    const sessionId = optionalText(body.sourceSessionId);
    if ([runId, taskId, sessionId].filter(Boolean).length > 1) {
      throw new DomainError("INVALID_SOURCE", "结构内容最多指定一个来源", 422, true);
    }
    if (runId && runs.get(runId)?.roomId !== roomId) throw new DomainError("INVALID_SOURCE", "来源请求不属于当前会话", 422, true);
    if (taskId && tasks.get(taskId)?.roomId !== roomId) throw new DomainError("INVALID_SOURCE", "来源任务不属于当前会话", 422, true);
    if (sessionId && sessions.get(sessionId)?.roomId !== roomId) throw new DomainError("INVALID_SOURCE", "来源项目工作线不属于当前会话", 422, true);
    return { sourceRunId: runId, sourceTaskId: taskId, sourceSessionId: sessionId };
  }

  function commitContext(roomId: string) {
    rooms.incrementContextRevision(roomId);
  }

  return {
    list(roomId: string) {
      if (!rooms.get(roomId)) throw new DomainError("NOT_FOUND", "会话不存在", 404, true);
      return contents.list(roomId);
    },
    create(roomId: string, body: Record<string, unknown>) {
      writableRoom(roomId);
      const kind = enumValue(body.kind, kinds, "kind");
      const status = enumValue(body.status, statusesByKind[kind], "status", defaultStatus(kind));
      const position = body.position === undefined ? 0 : Number(body.position);
      if (!Number.isInteger(position) || position < 0) throw new DomainError("INVALID_INPUT", "position 必须是非负整数", 400, true);
      const created = contents.create({
        roomId,
        kind,
        outputKind: kind === "output" ? enumValue(body.outputKind, outputKinds, "outputKind") : null,
        title: requiredText(body.title, "title", "内容标题"),
        body: requiredText(body.body, "body", "内容正文"),
        status,
        ...source(roomId, body),
        position,
      });
      commitContext(roomId);
      return created;
    },
    update(roomId: string, id: string, body: Record<string, unknown>) {
      writableRoom(roomId);
      const current = contents.get(id);
      if (!current || current.roomId !== roomId) throw new DomainError("NOT_FOUND", "结构内容不存在", 404, true);
      const position = body.position === undefined ? current.position : Number(body.position);
      if (!Number.isInteger(position) || position < 0) throw new DomainError("INVALID_INPUT", "position 必须是非负整数", 400, true);
      const status = enumValue(body.status, statusesByKind[current.kind], "status", current.status);
      const updated = contents.update(id, {
        title: body.title === undefined ? current.title : requiredText(body.title, "title", "内容标题"),
        body: body.body === undefined ? current.body : requiredText(body.body, "body", "内容正文"),
        status,
        position,
      })!;
      commitContext(roomId);
      return updated;
    },
    delete(roomId: string, id: string) {
      writableRoom(roomId);
      const current = contents.get(id);
      if (!current || current.roomId !== roomId) throw new DomainError("NOT_FOUND", "结构内容不存在", 404, true);
      if (!["candidate", "draft"].includes(current.status)) {
        throw new DomainError("CONTENT_HAS_HISTORY", "已采用或发布的内容应撤回或替代，不能直接删除", 409, true);
      }
      contents.delete(id);
      commitContext(roomId);
    },
  };
}
