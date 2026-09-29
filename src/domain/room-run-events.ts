import type { RoomRun, Task } from "@/domain/models";

export type RoomActivitySource = "router" | "session" | "direct" | "synthesizer";

export type RoomRunEvent =
  | { type: "run_created"; runId: string }
  | { type: "run_state"; state: RoomRun["state"] }
  | { type: "progress"; summary: string }
  | { type: "activity"; id: string; source: RoomActivitySource; kind: "thinking" | "execution"; state: "running" | "completed" | "error"; summary: string; taskId?: string; sessionId?: string; projectId?: string }
  | { type: "route_selected"; route: NonNullable<RoomRun["route"]> }
  | { type: "plan_proposed"; tasks: Task[] }
  | { type: "approval_required"; taskId: string; summary: string }
  | { type: "task_state"; taskId: string; state: Task["state"] }
  | { type: "task_progress"; taskId: string; summary: string }
  | { type: "response_delta"; text: string }
  | { type: "complete" }
  | { type: "error"; code: string; message: string; recoverable: boolean };
