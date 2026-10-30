import type { Project } from "@/domain/models";
import { database, schemaCompatible, assertSchemaCompatible } from "./database.server";
import { entityId, now, type DatabaseRow } from "./common";

function mapProject(row: DatabaseRow): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | null,
    kind: row.kind as Project["kind"],
    rootPath: row.root_path as string,
    status: row.status as Project["status"],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export const projectRepository = {
  list(): Project[] {
    assertSchemaCompatible();
    return (database
      .prepare("SELECT * FROM projects ORDER BY status, name, id")
      .all() as DatabaseRow[]).map(mapProject);
  },

  get(id: string): Project | null {
    assertSchemaCompatible();
    const row = database.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
      | DatabaseRow
      | undefined;
    return row ? mapProject(row) : null;
  },

  create(input: Omit<Project, "id" | "createdAt" | "updatedAt">): Project {
    assertSchemaCompatible();
    const id = entityId("project");
    const timestamp = now();
    database
      .prepare(
        `INSERT INTO projects
          (id, name, description, kind, root_path, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.description,
        input.kind,
        input.rootPath,
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
    assertSchemaCompatible();
    const current = this.get(id);
    if (!current) return null;
    database
      .prepare(
        `UPDATE projects SET name = ?, description = ?, kind = ?, root_path = ?,
          status = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        patch.name ?? current.name,
        patch.description === undefined ? current.description : patch.description,
        patch.kind ?? current.kind,
        patch.rootPath ?? current.rootPath,
        patch.status ?? current.status,
        now(),
        id,
      );
    return this.get(id);
  },

  delete(id: string): boolean {
    assertSchemaCompatible();
    return database.prepare("DELETE FROM projects WHERE id = ?").run(id).changes > 0;
  },

  isInUse(id: string): boolean {
    assertSchemaCompatible();
    return Boolean(database.prepare("SELECT id FROM sessions WHERE project_id=? UNION ALL SELECT id FROM session_memories WHERE project_id=? LIMIT 1").get(id,id));
  },
};
