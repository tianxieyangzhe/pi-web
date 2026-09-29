import type { Room, RoomProject } from "@/domain/models";
import { database } from "./database.server";
import { entityId, now, type DatabaseRow } from "./common";

function mapRoom(row: DatabaseRow): Room {
  return {
    id: row.id as string,
    kind: row.kind as Room["kind"],
    title: row.title as string,
    status: row.status as Room["status"],
    contextRevision: row.context_revision as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapRoomProject(row: DatabaseRow): RoomProject {
  return {
    id: row.id as string,
    roomId: row.room_id as string,
    projectId: row.project_id as string,
    position: row.position as number,
    createdAt: row.created_at as string,
  };
}

export const roomRepository = {
  list(): Room[] {
    return (database.prepare(
      `SELECT * FROM rooms
       ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'closed' THEN 2 ELSE 3 END,
         updated_at DESC, id`,
    ).all() as DatabaseRow[]).map(mapRoom);
  },

  listForProject(projectId: string): Room[] {
    return (database.prepare(
      `SELECT r.* FROM rooms r
       JOIN room_projects rp ON rp.room_id = r.id
       WHERE rp.project_id = ?
       ORDER BY r.updated_at DESC, r.id`,
    ).all(projectId) as DatabaseRow[]).map(mapRoom);
  },

  get(id: string): Room | null {
    const row = database.prepare("SELECT * FROM rooms WHERE id = ?").get(id) as DatabaseRow | undefined;
    return row ? mapRoom(row) : null;
  },

  listProjects(roomId: string): RoomProject[] {
    return (database.prepare(
      "SELECT * FROM room_projects WHERE room_id = ? ORDER BY position, id",
    ).all(roomId) as DatabaseRow[]).map(mapRoomProject);
  },

  create(input: { kind: Room["kind"]; title: string; projectIds: string[] }): Room {
    const id = entityId("room");
    const timestamp = now();
    database.transaction(() => {
      database.prepare(
        `INSERT INTO rooms (id, kind, title, status, context_revision, created_at, updated_at)
         VALUES (?, ?, ?, 'active', 1, ?, ?)`,
      ).run(id, input.kind, input.title, timestamp, timestamp);
      const insert = database.prepare(
        `INSERT INTO room_projects (id, room_id, project_id, position, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      input.projectIds.forEach((projectId, position) => {
        insert.run(entityId("room_project"), id, projectId, position, timestamp);
      });
    })();
    return this.get(id)!;
  },

  update(id: string, patch: Partial<Pick<Room, "title" | "status">>): Room | null {
    const current = this.get(id);
    if (!current) return null;
    database.prepare("UPDATE rooms SET title = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(patch.title ?? current.title, patch.status ?? current.status, now(), id);
    return this.get(id);
  },

  touch(id: string): void {
    database.prepare("UPDATE rooms SET updated_at = ? WHERE id = ?").run(now(), id);
  },

  incrementContextRevision(id: string): Room | null {
    database.prepare(
      "UPDATE rooms SET context_revision = context_revision + 1, updated_at = ? WHERE id = ?",
    ).run(now(), id);
    return this.get(id);
  },

  delete(id: string): boolean {
    return database.prepare("DELETE FROM rooms WHERE id = ?").run(id).changes > 0;
  },
};
