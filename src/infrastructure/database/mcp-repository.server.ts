import type { Mcp, McpConfig } from "@/domain/models";
import { database, assertSchemaCompatible } from "./database.server";
import { entityId, now, type DatabaseRow } from "./common";
import { parseJson, stringifyJson } from "./json";

function mapMcp(row: DatabaseRow): Mcp {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | null,
    config: parseJson<McpConfig>(row.config_json, "mcps.config_json"),
    accessPolicy: row.access_policy as Mcp["accessPolicy"],
    status: row.status as Mcp["status"],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export const mcpRepository = {
  list(): Mcp[] {
    return (database.prepare("SELECT * FROM mcps ORDER BY status, name, id").all() as DatabaseRow[]).map(
      mapMcp,
    );
  },

  get(id: string): Mcp | null {
    const row = database.prepare("SELECT * FROM mcps WHERE id = ?").get(id) as
      | DatabaseRow
      | undefined;
    return row ? mapMcp(row) : null;
  },

  create(input: Omit<Mcp, "id" | "createdAt" | "updatedAt">): Mcp {
    assertSchemaCompatible();
    const id = entityId("mcp");
    const timestamp = now();
    database
      .prepare(
        `INSERT INTO mcps
          (id, name, description, config_json, access_policy, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.description,
        stringifyJson(input.config),
        input.accessPolicy,
        input.status,
        timestamp,
        timestamp,
      );
    return this.get(id)!;
  },

  update(
    id: string,
    patch: Partial<Omit<Mcp, "id" | "createdAt" | "updatedAt">>,
  ): Mcp | null {
    assertSchemaCompatible();
    const current = this.get(id);
    if (!current) return null;
    database
      .prepare(
        `UPDATE mcps SET name = ?, description = ?, config_json = ?, access_policy = ?,
          status = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        patch.name ?? current.name,
        patch.description === undefined ? current.description : patch.description,
        stringifyJson(patch.config ?? current.config),
        patch.accessPolicy ?? current.accessPolicy,
        patch.status ?? current.status,
        now(),
        id,
      );
    return this.get(id);
  },

  delete(id: string): boolean {
    assertSchemaCompatible();
    return database.prepare("DELETE FROM mcps WHERE id = ?").run(id).changes > 0;
  },

  isInUse(id: string): boolean {
    return Boolean(
      database
        .prepare(
          `SELECT id FROM sessions WHERE EXISTS (
            SELECT 1 FROM json_each(mcp_ids_json) WHERE value = ?
          )
           UNION ALL
           SELECT id FROM tasks WHERE EXISTS (
             SELECT 1 FROM json_each(mcp_ids_json) WHERE value = ?
           )
           LIMIT 1`,
        )
        .get(id, id),
    );
  },
};
