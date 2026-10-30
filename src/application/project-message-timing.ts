import { randomUUID } from "node:crypto";

export type ProjectMessageStage = "accepted" | "handle_reused" | "handle_opened" | "handle_restored" | "prompt_start" | "assistant_stream" | "first_text" | "first_tool" | "completed" | "failed" | "cancelled";

export function createProjectMessageTiming(sessionId: string, options: {
  now?: () => number;
  log?: (line: string) => void;
} = {}) {
  const now = options.now ?? (() => performance.now());
  const log = options.log ?? ((line: string) => console.info(line));
  const started = now();
  const id = randomUUID();
  const seen = new Set<ProjectMessageStage>();
  return (stage: ProjectMessageStage) => {
    if (seen.has(stage)) return;
    seen.add(stage);
    // Diagnostics must never change the request outcome, even if logging fails.
    try {
      log(`[project-message-timing] ${JSON.stringify({ id, sessionId, stage, elapsedMs: Math.round((now() - started) * 10) / 10 })}`);
    } catch { /* best effort */ }
  };
}
