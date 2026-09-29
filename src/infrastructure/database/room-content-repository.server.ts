import type { RoomContent } from "@/domain/models";
import { database } from "./database.server";
import { entityId, now, type DatabaseRow } from "./common";

function mapRoomContent(row: DatabaseRow): RoomContent {
  return {
    id: row.id as string,
    roomId: row.room_id as string,
    kind: row.kind as RoomContent["kind"],
    outputKind: row.output_kind as RoomContent["outputKind"],
    title: row.title as string,
    body: row.body as string,
    status: row.status as RoomContent["status"],
    sourceRunId: row.source_run_id as string | null,
    sourceTaskId: row.source_task_id as string | null,
    sourceSessionId: row.source_session_id as string | null,
    position: row.position as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export const roomContentRepository = {
  list(roomId: string): RoomContent[] {
    return (database
      .prepare(
        `SELECT * FROM room_contents WHERE room_id = ?
         ORDER BY CASE kind
           WHEN 'overview' THEN 0 WHEN 'goal' THEN 1 WHEN 'rule' THEN 2
           WHEN 'memory' THEN 3 WHEN 'direction' THEN 4 WHEN 'decision' THEN 5 ELSE 6 END,
           position, updated_at DESC, id`,
      )
      .all(roomId) as DatabaseRow[]).map(mapRoomContent);
  },

  get(id: string): RoomContent | null {
    const row = database.prepare("SELECT * FROM room_contents WHERE id = ?").get(id) as
      | DatabaseRow
      | undefined;
    return row ? mapRoomContent(row) : null;
  },

  create(input: Omit<RoomContent, "id" | "createdAt" | "updatedAt">): RoomContent {
    const id = entityId("room_content");
    const timestamp = now();
    database.transaction(() => {
      if ((input.kind === "goal" || input.kind === "overview") && input.status === "active") {
        database
          .prepare(
            `UPDATE room_contents SET status = 'superseded', updated_at = ?
             WHERE room_id = ? AND kind = ? AND status = 'active'`,
          )
          .run(timestamp, input.roomId, input.kind);
      }
      database
        .prepare(
          `INSERT INTO room_contents (
            id, room_id, kind, output_kind, title, body, status,
            source_run_id, source_task_id, source_session_id, position, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.roomId,
          input.kind,
          input.outputKind,
          input.title,
          input.body,
          input.status,
          input.sourceRunId,
          input.sourceTaskId,
          input.sourceSessionId,
          input.position,
          timestamp,
          timestamp,
        );
    })();
    return this.get(id)!;
  },

  update(
    id: string,
    input: Pick<RoomContent, "title" | "body" | "status" | "position">,
  ): RoomContent | null {
    const current = this.get(id);
    if (!current) return null;
    const timestamp = now();
    database.transaction(() => {
      if ((current.kind === "goal" || current.kind === "overview") && input.status === "active") {
        database
          .prepare(
            `UPDATE room_contents SET status = 'superseded', updated_at = ?
             WHERE room_id = ? AND kind = ? AND status = 'active' AND id <> ?`,
          )
          .run(timestamp, current.roomId, current.kind, id);
      }
      database
        .prepare(
          `UPDATE room_contents SET title = ?, body = ?, status = ?, position = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(input.title, input.body, input.status, input.position, timestamp, id);
    })();
    return this.get(id);
  },

  delete(id: string): boolean {
    return database.prepare("DELETE FROM room_contents WHERE id = ?").run(id).changes > 0;
  },
};
