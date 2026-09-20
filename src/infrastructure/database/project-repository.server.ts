import type { Project } from "@/domain/models";
import { database } from "./database.server";
import { entityId, now, type DatabaseRow } from "./common";

function mapProject(row: DatabaseRow): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | null,
    kind: row.kind as Project["kind"],
    rootPath: row.root_path as string,
    accessMode: row.access_mode as Project["accessMode"],
    status: row.status as Project["status"],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export const projectRepository = {
  list(): Project[] {
    return (database
      .prepare("SELECT * FROM projects ORDER BY status, name, id")
      .all() as DatabaseRow[]).map(mapProject);
  },

  get(id: string): Project | null {
    const row = database.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
      | DatabaseRow
      | undefined;
    return row ? mapProject(row) : null;
  },

  create(input: Omit<Project, "id" | "createdAt" | "updatedAt">): Project {
    const id = entityId("project");
    const timestamp = now();
    database
      .prepare(
        `INSERT INTO projects
          (id, name, description, kind, root_path, access_mode, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.description,
        input.kind,
        input.rootPath,
        input.accessMode,
        input.status,
        timestamp,
        timestamp,
      );
    return this.get(id)!;
  },

  update(
    id: string,
    patch: Partial<Omit<Project, "id" | "createdAt" | "updatedAt">>,
  ): Project | null {
    const current = this.get(id);
    if (!current) return null;
    database
      .prepare(
        `UPDATE projects SET name = ?, description = ?, kind = ?, root_path = ?,
          access_mode = ?, status = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        patch.name ?? current.name,
        patch.description === undefined ? current.description : patch.description,
        patch.kind ?? current.kind,
        patch.rootPath ?? current.rootPath,
        patch.accessMode ?? current.accessMode,
        patch.status ?? current.status,
        now(),
        id,
      );
    return this.get(id);
  },

  delete(id: string): boolean {
    return database.prepare("DELETE FROM projects WHERE id = ?").run(id).changes > 0;
  },

  isInUse(id: string): boolean {
    return Boolean(
      database
        .prepare(
          `SELECT id FROM sessions WHERE state <> 'ended' AND
            (working_project_id = ? OR EXISTS (
              SELECT 1 FROM json_each(reference_project_ids_json) WHERE value = ?
            )) LIMIT 1`,
        )
        .get(id, id),
    );
  },
};
