import type { Room } from "@/domain/models";
import { database } from "./database.server";
import { entityId, now, type DatabaseRow } from "./common";

function mapRoom(row: DatabaseRow): Room {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    title: row.title as string,
    status: row.status as Room["status"],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export const roomRepository = {
  list(workspaceId: string): Room[] {
    return (database
      .prepare(
        `SELECT * FROM rooms WHERE workspace_id = ?
         ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'closed' THEN 2 ELSE 3 END,
           updated_at DESC, id`,
      )
      .all(workspaceId) as DatabaseRow[]).map(mapRoom);
  },

  get(id: string): Room | null {
    const row = database.prepare("SELECT * FROM rooms WHERE id = ?").get(id) as
      | DatabaseRow
      | undefined;
    return row ? mapRoom(row) : null;
  },

  create(workspaceId: string, title = "新会话"): Room {
    const id = entityId("room");
    const timestamp = now();
    database
      .prepare(
        `INSERT INTO rooms (id, workspace_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?)`,
      )
      .run(id, workspaceId, title, timestamp, timestamp);
    return this.get(id)!;
  },

  update(
    id: string,
    patch: Partial<Pick<Room, "title" | "status">>,
  ): Room | null {
    const current = this.get(id);
    if (!current) return null;
    database
      .prepare("UPDATE rooms SET title = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(patch.title ?? current.title, patch.status ?? current.status, now(), id);
    return this.get(id);
  },

  touch(id: string): void {
    database.prepare("UPDATE rooms SET updated_at = ? WHERE id = ?").run(now(), id);
  },

  delete(id: string): boolean {
    return database.prepare("DELETE FROM rooms WHERE id = ?").run(id).changes > 0;
  },
};
