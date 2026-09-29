import type { Agent, AgentPolicy, PiAgentExtension } from "@/domain/models";
import { database } from "./database.server";
import { entityId, now, type DatabaseRow } from "./common";
import { parseJson, stringifyJson } from "./json";

function mapAgent(row: DatabaseRow): Agent {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | null,
    extension: parseJson<PiAgentExtension>(row.extension_json, "agents.extension_json"),
    policy: parseJson<AgentPolicy>(row.policy_json, "agents.policy_json"),
    revision: row.revision as number,
    status: row.status as Agent["status"],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export const agentRepository = {
  list(): Agent[] {
    return (database.prepare("SELECT * FROM agents ORDER BY status, name, id").all() as DatabaseRow[]).map(
      mapAgent,
    );
  },

  get(id: string): Agent | null {
    const row = database.prepare("SELECT * FROM agents WHERE id = ?").get(id) as
      | DatabaseRow
      | undefined;
    return row ? mapAgent(row) : null;
  },

  create(input: Omit<Agent, "id" | "revision" | "createdAt" | "updatedAt">): Agent {
    const id = entityId("agent");
    const timestamp = now();
    database
      .prepare(
        `INSERT INTO agents
          (id, name, description, extension_json, policy_json, revision, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.description,
        stringifyJson(input.extension),
        stringifyJson(input.policy),
        input.status,
        timestamp,
        timestamp,
      );
    return this.get(id)!;
  },

  update(
    id: string,
    patch: Partial<Omit<Agent, "id" | "revision" | "createdAt" | "updatedAt">>,
  ): Agent | null {
    const current = this.get(id);
    if (!current) return null;
    database
      .prepare(
        `UPDATE agents SET name = ?, description = ?, extension_json = ?, policy_json = ?,
          revision = revision + 1, status = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        patch.name ?? current.name,
        patch.description === undefined ? current.description : patch.description,
        stringifyJson(patch.extension ?? current.extension),
        stringifyJson(patch.policy ?? current.policy),
        patch.status ?? current.status,
        now(),
        id,
      );
    return this.get(id);
  },

  delete(id: string): boolean {
    return database.prepare("DELETE FROM agents WHERE id = ?").run(id).changes > 0;
  },

  isInUse(id: string): boolean {
    return Boolean(
      database
        .prepare(
          `SELECT id FROM sessions WHERE agent_id = ?
           UNION ALL
           SELECT id FROM tasks WHERE agent_id = ?
           LIMIT 1`,
        )
        .get(id, id),
    );
  },
};
