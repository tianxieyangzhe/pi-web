import type { Workspace } from "@/domain/models";
import { database } from "./database.server";
import { entityId, now, type DatabaseRow } from "./common";

function mapWorkspace(row: DatabaseRow): Workspace {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | null,
    status: row.status as Workspace["status"],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export const workspaceRepository = {
  list(): Workspace[] {
    return (database
      .prepare("SELECT * FROM workspaces ORDER BY created_at, name, id")
      .all() as DatabaseRow[]).map(mapWorkspace);
  },

  get(id: string): Workspace | null {
    const row = database.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as
      | DatabaseRow
      | undefined;
    return row ? mapWorkspace(row) : null;
  },

  create(input: { name: string; description: string | null }): Workspace {
    const id = entityId("workspace");
    const timestamp = now();
    database
      .prepare(
        "INSERT INTO workspaces (id, name, description, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
      )
      .run(id, input.name, input.description, timestamp, timestamp);
    return this.get(id)!;
  },

  update(
    id: string,
    patch: Partial<Pick<Workspace, "name" | "description" | "status">>,
  ): Workspace | null {
    const current = this.get(id);
    if (!current) return null;
    database
      .prepare(
        "UPDATE workspaces SET name = ?, description = ?, status = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        patch.name ?? current.name,
        patch.description === undefined ? current.description : patch.description,
        patch.status ?? current.status,
        now(),
        id,
      );
    return this.get(id);
  },

  delete(id: string): boolean {
    return database.prepare("DELETE FROM workspaces WHERE id = ?").run(id).changes > 0;
  },
};
