import type { Task, TaskResult } from "@/domain/models";
import { database } from "./database.server";
import { entityId, now, type DatabaseRow } from "./common";
import { parseJson, stringifyJson } from "./json";

function mapTask(row: DatabaseRow): Task {
  return {
    id: row.id as string,
    roomId: row.room_id as string,
    runId: row.run_id as string,
    retryOfTaskId: row.retry_of_task_id as string | null,
    projectId: row.project_id as string,
    sessionId: row.session_id as string | null,
    agentId: row.agent_id as string | null,
    mcpIds: parseJson<string[]>(row.mcp_ids_json, "tasks.mcp_ids_json"),
    instruction: row.instruction as string,
    acceptance: parseJson<string[]>(row.acceptance_json, "tasks.acceptance_json"),
    operation: row.operation as Task["operation"],
    risk: row.risk as Task["risk"],
    state: row.state as Task["state"],
    result: row.result_json ? parseJson<TaskResult>(row.result_json, "tasks.result_json") : null,
    createdAt: row.created_at as string,
    startedAt: row.started_at as string | null,
    completedAt: row.completed_at as string | null,
  };
}

export const taskRepository = {
  listForRun(runId: string): Task[] {
    return (database
      .prepare("SELECT * FROM tasks WHERE run_id = ? ORDER BY created_at, id")
      .all(runId) as DatabaseRow[]).map(mapTask);
  },

  listForRoom(roomId: string): Task[] {
    return (database
      .prepare("SELECT * FROM tasks WHERE room_id = ? ORDER BY created_at DESC, id DESC")
      .all(roomId) as DatabaseRow[]).map(mapTask);
  },

  get(id: string): Task | null {
    const row = database.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | DatabaseRow
      | undefined;
    return row ? mapTask(row) : null;
  },

  create(input: Omit<Task, "id" | "createdAt" | "startedAt" | "completedAt" | "result">): Task {
    const id = entityId("task");
    const timestamp = now();
    database
      .prepare(
        `INSERT INTO tasks (
          id, room_id, run_id, retry_of_task_id, project_id, session_id, agent_id,
          mcp_ids_json, instruction, acceptance_json, operation, risk, state,
          result_json, created_at, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL)`,
      )
      .run(
        id,
        input.roomId,
        input.runId,
        input.retryOfTaskId,
        input.projectId,
        input.sessionId,
        input.agentId,
        stringifyJson(input.mcpIds),
        input.instruction,
        stringifyJson(input.acceptance),
        input.operation,
        input.risk,
        input.state,
        timestamp,
      );
    return this.get(id)!;
  },

  update(
    id: string,
    patch: Pick<Partial<Task>, "sessionId" | "state" | "result" | "startedAt" | "completedAt">,
  ): Task | null {
    const current = this.get(id);
    if (!current) return null;
    database
      .prepare(
        `UPDATE tasks SET session_id = ?, state = ?, result_json = ?, started_at = ?, completed_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.sessionId === undefined ? current.sessionId : patch.sessionId,
        patch.state ?? current.state,
        patch.result === undefined
          ? current.result
            ? stringifyJson(current.result)
            : null
          : patch.result
            ? stringifyJson(patch.result)
            : null,
        patch.startedAt === undefined ? current.startedAt : patch.startedAt,
        patch.completedAt === undefined ? current.completedAt : patch.completedAt,
        id,
      );
    return this.get(id);
  },
};
