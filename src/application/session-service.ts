import { DomainError } from "@/domain/errors";
import type { Session } from "@/domain/models";
import type { RoomRepositoryPort, SessionRepositoryPort } from "@/application/ports/core";

export function createSessionService(dependencies: {
  rooms: RoomRepositoryPort;
  sessions: SessionRepositoryPort;
}) {
  const { rooms, sessions } = dependencies;

  function sessionInRoom(roomId: string, sessionId: string): Session {
    const session = sessions.get(sessionId);
    if (!session || session.roomId !== roomId) {
      throw new DomainError("NOT_FOUND", "项目工作线不存在", 404, true);
    }
    return session;
  }

  return {
    list(roomId: string) {
      if (!rooms.get(roomId)) throw new DomainError("NOT_FOUND", "会话不存在", 404, true);
      return sessions.listForRoom(roomId);
    },
    get: sessionInRoom,
    end(roomId: string, sessionId: string) {
      const session = sessionInRoom(roomId, sessionId);
      if (["starting", "running", "interrupting"].includes(session.state)) {
        throw new DomainError("SESSION_RUNNING", "请先停止项目工作线", 409, true);
      }
      return sessions.updateRuntime(sessionId, {
        state: "ended",
        endedAt: new Date().toISOString(),
      })!;
    },
  };
}
