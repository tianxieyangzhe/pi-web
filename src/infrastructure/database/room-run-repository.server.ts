import type { RoomRun } from "@/domain/models";
import { database } from "./database.server";
import { entityId, now, type DatabaseRow } from "./common";

function mapRoomRun(row: DatabaseRow): RoomRun {
  return {
    id: row.id as string,
    roomId: row.room_id as string,
    requestText: row.request_text as string,
    projectHintId: row.project_hint_id as string | null,
    route: row.route as RoomRun["route"],
    state: row.state as RoomRun["state"],
    routerSummary: row.router_summary as string | null,
    finalResponse: row.final_response as string | null,
    errorCode: row.error_code as string | null,
    contextRevision: row.context_revision as number,
    createdAt: row.created_at as string,
    startedAt: row.started_at as string | null,
    completedAt: row.completed_at as string | null,
  };
}

export const roomRunRepository = {
  listForRoom(roomId: string): RoomRun[] {
    return (database
      .prepare("SELECT * FROM room_runs WHERE room_id = ? ORDER BY created_at DESC, id DESC")
      .all(roomId) as DatabaseRow[]).map(mapRoomRun);
  },

  get(id: string): RoomRun | null {
    const row = database.prepare("SELECT * FROM room_runs WHERE id = ?").get(id) as
      | DatabaseRow
      | undefined;
    return row ? mapRoomRun(row) : null;
  },

  create(input: Pick<RoomRun, "roomId" | "requestText" | "projectHintId" | "contextRevision">): RoomRun {
    const id = entityId("run");
    const timestamp = now();
    database
      .prepare(
        `INSERT INTO room_runs (
          id, room_id, request_text, project_hint_id, route, state, router_summary,
          final_response, error_code, context_revision, created_at, started_at, completed_at
        ) VALUES (?, ?, ?, ?, NULL, 'received', NULL, NULL, NULL, ?, ?, NULL, NULL)`,
      )
      .run(id, input.roomId, input.requestText, input.projectHintId, input.contextRevision, timestamp);
    return this.get(id)!;
  },

  update(
    id: string,
    patch: Partial<Pick<RoomRun, "route" | "state" | "routerSummary" | "finalResponse" | "errorCode" | "startedAt" | "completedAt">>,
  ): RoomRun | null {
    const current = this.get(id);
    if (!current) return null;
    database
      .prepare(
        `UPDATE room_runs SET route = ?, state = ?, router_summary = ?, final_response = ?,
          error_code = ?, started_at = ?, completed_at = ? WHERE id = ?`,
      )
      .run(
        patch.route === undefined ? current.route : patch.route,
        patch.state ?? current.state,
        patch.routerSummary === undefined ? current.routerSummary : patch.routerSummary,
        patch.finalResponse === undefined ? current.finalResponse : patch.finalResponse,
        patch.errorCode === undefined ? current.errorCode : patch.errorCode,
        patch.startedAt === undefined ? current.startedAt : patch.startedAt,
        patch.completedAt === undefined ? current.completedAt : patch.completedAt,
        id,
      );
    return this.get(id);
  },
};
