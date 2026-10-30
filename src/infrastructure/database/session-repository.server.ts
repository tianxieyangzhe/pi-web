import {DomainError} from "@/domain/errors";
import type { JsonObject, Mcp, Session } from "@/domain/models";
import { hydrateAgentSnapshot, serializeAgentSnapshot } from "./agent-snapshot.server";
import { database, assertSchemaCompatible } from "./database.server";
import { entityId, now, type DatabaseRow } from "./common";
import { parseJson, stringifyJson } from "./json";
const hasSessionStatusColumn=(database.prepare('PRAGMA table_info(sessions)').all() as Array<{name:string}>).some(column=>column.name==='status');

function mapSession(row: DatabaseRow): Session {
  return {
    id: row.id as string,
    sessionMemoryId: row.session_memory_id as string,
    projectId: row.project_id as string,
    status: (row.status as Session["status"]|undefined)??(row.ended_at||row.state==='ended'?'closed':'open'),
    purpose: row.purpose as string,
    botConversationId:row.bot_conversation_id as string|null,participantName:row.participant_name as string|null,assignment:row.assignment as string|null,collaborationState:row.collaboration_state as Session["collaborationState"],botJoinedAt:row.bot_joined_at as string|null,updatedAt:row.updated_at as string,
    agentId: row.agent_id as string | null,
    agentSnapshot: row.agent_snapshot_json ? hydrateAgentSnapshot(parseJson<unknown>(row.agent_snapshot_json, "sessions.agent_snapshot_json")) : null,
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
  "projectId" | "purpose" | "agentId" | "agentSnapshot" | "mcpIds" | "mcpSnapshots"
> & { sessionMemoryId: string;stableId?:string };

export const sessionRepository = {
  listForProject(projectId: string): Session[] {
    assertSchemaCompatible();
    return (database
      .prepare("SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at, id")
      .all(projectId) as DatabaseRow[]).map(mapSession);
  },

  get(id: string): Session | null {
    assertSchemaCompatible();
    const row = database.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
      | DatabaseRow
      | undefined;
    return row ? mapSession(row) : null;
  },

  create(input: CreateSessionRecord): Session {
    assertSchemaCompatible();
    const memoryId = input.sessionMemoryId;
    if (!memoryId) throw new DomainError("INVALID_SESSION_MEMORY", "每个 Session 必须绑定一份独有记忆", 422, true);
    const id = input.stableId??entityId("session");
    const timestamp = now();
    database
      .prepare(hasSessionStatusColumn?`INSERT INTO sessions (
          id, session_memory_id, project_id, purpose, agent_id, agent_snapshot_json,
          mcp_ids_json, mcp_snapshots_json, status, state, native_ref_json,
          native_metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', 'not_started', NULL, '{}', ?, ?)`: `INSERT INTO sessions (
          id, session_memory_id, project_id, purpose, agent_id, agent_snapshot_json,
          mcp_ids_json, mcp_snapshots_json, state, native_ref_json,
          native_metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'not_started', NULL, '{}', ?, ?)`,)
      .run(
        id,
        memoryId,
        input.projectId,
        input.purpose,
        input.agentId,
        input.agentSnapshot ? stringifyJson(serializeAgentSnapshot(input.agentSnapshot)) : null,
        stringifyJson(input.mcpIds),
        stringifyJson(input.mcpSnapshots),
        timestamp, timestamp,
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
    assertSchemaCompatible();
    const current = this.get(id);
    if (!current) return null;
    database
      .prepare(hasSessionStatusColumn?`UPDATE sessions SET state = ?, native_ref_json = ?, native_metadata_json = ?, status = ?,
          last_activity_at = ?, ended_at = ? WHERE id = ?`:`UPDATE sessions SET state = ?, native_ref_json = ?, native_metadata_json = ?,
          last_activity_at = ?, ended_at = ? WHERE id = ?`)
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
        ...(hasSessionStatusColumn?[patch.endedAt===undefined?current.status:patch.endedAt?'closed':'open']:[]),
        now(),
        patch.endedAt === undefined ? current.endedAt : patch.endedAt,
        id,
      );
    return this.get(id);
  },

  markInterruptedAfterRestart(): number {
    assertSchemaCompatible();
    return database
      .prepare("UPDATE sessions SET state = 'unavailable' WHERE state IN ('starting','running','interrupting')")
      .run().changes;
  },
};
