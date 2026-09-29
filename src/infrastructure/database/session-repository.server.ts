import type { Agent, JsonObject, Mcp, Session } from "@/domain/models";
import { database } from "./database.server";
import { entityId, now, type DatabaseRow } from "./common";
import { parseJson, stringifyJson } from "./json";

function mapSession(row: DatabaseRow): Session {
  return {
    id: row.id as string,
    roomId: row.room_id as string | null,
    projectId: row.project_id as string,
    purpose: row.purpose as string,
    agentId: row.agent_id as string | null,
    agentSnapshot: row.agent_snapshot_json
      ? parseJson<Agent>(row.agent_snapshot_json, "sessions.agent_snapshot_json")
      : null,
    mcpIds: parseJson<string[]>(row.mcp_ids_json, "sessions.mcp_ids_json"),
    mcpSnapshots: parseJson<Mcp[]>(row.mcp_snapshots_json, "sessions.mcp_snapshots_json"),
    state: row.state as Session["state"],
    nativeRef: row.native_ref_json
      ? parseJson<JsonObject>(row.native_ref_json, "sessions.native_ref_json")
      : null,
    nativeMetadata: parseJson<JsonObject>(row.native_metadata_json, "sessions.native_metadata_json"),
    createdAt: row.created_at as string,
    lastActivityAt: row.last_activity_at as string | null,
    endedAt: row.ended_at as string | null,
  };
}

export type CreateSessionRecord = Pick<
  Session,
  "roomId" | "projectId" | "purpose" | "agentId" | "agentSnapshot" | "mcpIds" | "mcpSnapshots"
>;

export const sessionRepository = {
  listForRoom(roomId: string): Session[] {
    return (database
      .prepare("SELECT * FROM sessions WHERE room_id = ? ORDER BY created_at, id")
      .all(roomId) as DatabaseRow[]).map(mapSession);
  },

  listForProject(projectId: string): Session[] {
    return (database
      .prepare("SELECT * FROM sessions WHERE project_id = ? AND room_id IS NULL ORDER BY created_at, id")
      .all(projectId) as DatabaseRow[]).map(mapSession);
  },

  get(id: string): Session | null {
    const row = database.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
      | DatabaseRow
      | undefined;
    return row ? mapSession(row) : null;
  },

  create(input: CreateSessionRecord): Session {
    const id = entityId("session");
    const timestamp = now();
    database
      .prepare(
        `INSERT INTO sessions (
          id, room_id, project_id, purpose, agent_id, agent_snapshot_json,
          mcp_ids_json, mcp_snapshots_json, state, native_ref_json,
          native_metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'not_started', NULL, '{}', ?)`,
      )
      .run(
        id,
        input.roomId,
        input.projectId,
        input.purpose,
        input.agentId,
        input.agentSnapshot ? stringifyJson(input.agentSnapshot) : null,
        stringifyJson(input.mcpIds),
        stringifyJson(input.mcpSnapshots),
        timestamp,
      );
    return this.get(id)!;
  },

  updateRuntime(
    id: string,
    patch: {
      state?: Session["state"];
      nativeRef?: JsonObject | null;
      nativeMetadata?: JsonObject;
      endedAt?: string | null;
    },
  ): Session | null {
    const current = this.get(id);
    if (!current) return null;
    database
      .prepare(
        `UPDATE sessions SET state = ?, native_ref_json = ?, native_metadata_json = ?,
          last_activity_at = ?, ended_at = ? WHERE id = ?`,
      )
      .run(
        patch.state ?? current.state,
        patch.nativeRef === undefined
          ? current.nativeRef
            ? stringifyJson(current.nativeRef)
            : null
          : patch.nativeRef
            ? stringifyJson(patch.nativeRef)
            : null,
        stringifyJson(patch.nativeMetadata ?? current.nativeMetadata),
        now(),
        patch.endedAt === undefined ? current.endedAt : patch.endedAt,
        id,
      );
    return this.get(id);
  },

  markInterruptedAfterRestart(): number {
    return database
      .prepare("UPDATE sessions SET state = 'unavailable' WHERE state IN ('starting','running','interrupting')")
      .run().changes;
  },
};
