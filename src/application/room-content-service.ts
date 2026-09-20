import {
  DomainError,
  enumValue,
  optionalText,
  requiredText,
} from "@/domain/errors";
import type { RoomContent } from "@/domain/models";
import type {
  RoomContentRepositoryPort,
  RoomRepositoryPort,
  SessionRepositoryPort,
} from "@/application/ports/core";

const kinds = ["overview", "goal", "direction", "output"] as const;
const outputKinds = ["note", "decision", "plan", "delivery", "summary"] as const;
const statusesByKind = {
  overview: ["active", "superseded"],
  goal: ["active", "superseded", "retracted"],
  direction: ["candidate", "adopted", "dismissed"],
  output: ["draft", "published", "superseded", "retracted"],
} as const;

const allowedTransitions: Record<RoomContent["kind"], Record<string, readonly RoomContent["status"][]>> = {
  overview: {
    active: ["active", "superseded"],
    superseded: ["superseded"],
  },
  goal: {
    active: ["active", "superseded", "retracted"],
    superseded: ["superseded"],
    retracted: ["retracted"],
  },
  direction: {
    candidate: ["candidate", "adopted", "dismissed"],
    adopted: ["adopted", "dismissed"],
    dismissed: ["dismissed"],
  },
  output: {
    draft: ["draft", "published", "retracted"],
    published: ["published", "superseded", "retracted"],
    superseded: ["superseded"],
    retracted: ["retracted"],
  },
};

function defaultStatus(kind: RoomContent["kind"]): RoomContent["status"] {
  if (kind === "overview" || kind === "goal") return "active";
  if (kind === "direction") return "candidate";
  return "draft";
}

export function createRoomContentService(dependencies: {
  rooms: RoomRepositoryPort;
  sessions: SessionRepositoryPort;
  contents: RoomContentRepositoryPort;
}) {
  const { rooms, sessions, contents } = dependencies;

  function roomExists(roomId: string) {
    const room = rooms.get(roomId);
    if (!room) throw new DomainError("NOT_FOUND", "会话不存在", 404, true);
    if (room.status === "archived") {
      throw new DomainError("ROOM_ARCHIVED", "归档会话不能修改内容", 409, true);
    }
    return room;
  }

  function sourceSessionId(roomId: string, value: unknown): string | null {
    const id = optionalText(value);
    if (!id) return null;
    const session = sessions.get(id);
    if (!session || session.roomId !== roomId) {
      throw new DomainError("INVALID_SOURCE", "来源工作线不属于当前会话", 422, true);
    }
    return id;
  }

  function statusForKind(kind: RoomContent["kind"], value: unknown) {
    const allowed = statusesByKind[kind] as readonly RoomContent["status"][];
    return enumValue(value, allowed, "status", defaultStatus(kind));
  }

  return {
    list(roomId: string) {
      if (!rooms.get(roomId)) throw new DomainError("NOT_FOUND", "会话不存在", 404, true);
      return contents.list(roomId);
    },
    create(roomId: string, body: Record<string, unknown>) {
      roomExists(roomId);
      const kind = enumValue(body.kind, kinds, "kind");
      const outputKind = kind === "output"
        ? enumValue(body.outputKind, outputKinds, "outputKind")
        : null;
      const position = body.position === undefined ? 0 : Number(body.position);
      if (!Number.isInteger(position) || position < 0) {
        throw new DomainError("INVALID_INPUT", "position 必须是非负整数", 400, true);
      }
      const created = contents.create({
        roomId,
        kind,
        outputKind,
        title: requiredText(body.title, "title", "内容标题"),
        body: requiredText(body.body, "body", "内容正文"),
        status: statusForKind(kind, body.status),
        sourceSessionId: sourceSessionId(roomId, body.sourceSessionId),
        position,
      });
      rooms.touch(roomId);
      return created;
    },
    update(roomId: string, id: string, body: Record<string, unknown>) {
      roomExists(roomId);
      const current = contents.get(id);
      if (!current || current.roomId !== roomId) {
        throw new DomainError("NOT_FOUND", "结构内容不存在", 404, true);
      }
      const position = body.position === undefined ? current.position : Number(body.position);
      if (!Number.isInteger(position) || position < 0) {
        throw new DomainError("INVALID_INPUT", "position 必须是非负整数", 400, true);
      }
      const nextStatus = statusForKind(current.kind, body.status ?? current.status);
      if (!allowedTransitions[current.kind][current.status]?.includes(nextStatus)) {
        throw new DomainError(
          "INVALID_CONTENT_TRANSITION",
          `结构内容不能从 ${current.status} 变为 ${nextStatus}`,
          409,
          true,
        );
      }
      const updated = contents.update(id, {
        title:
          body.title === undefined
            ? current.title
            : requiredText(body.title, "title", "内容标题"),
        body:
          body.body === undefined
            ? current.body
            : requiredText(body.body, "body", "内容正文"),
        status: nextStatus,
        position,
      })!;
      rooms.touch(roomId);
      return updated;
    },
    delete(roomId: string, id: string) {
      roomExists(roomId);
      const current = contents.get(id);
      if (!current || current.roomId !== roomId) {
        throw new DomainError("NOT_FOUND", "结构内容不存在", 404, true);
      }
      if (current.status !== "candidate" && current.status !== "draft") {
        throw new DomainError(
          "CONTENT_HAS_HISTORY",
          "已采用或发布的内容应撤回或替代，不能直接删除",
          409,
          true,
        );
      }
      contents.delete(id);
      rooms.touch(roomId);
    },
  };
}
