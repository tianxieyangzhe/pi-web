import "server-only";

import type { AgentEvent } from "@/domain/models";

export function agentEventStreamResponse(
  sessionId: string,
  source: AsyncGenerator<AgentEvent>,
) {
  const encoder = new TextEncoder();
  const turnId = crypto.randomUUID();
  let sequence = 0;
  const started = performance.now();
  let firstTextLogged = false;
  const logStage = (stage: "first_text_enqueued" | "complete_enqueued") => {
    try {
      console.info(`[project-message-stream] ${JSON.stringify({ turnId, sessionId, stage, elapsedMs: Math.round((performance.now() - started) * 10) / 10, at: new Date().toISOString() })}`);
    } catch { /* best effort */ }
  };
  let disconnected = false;
  const stream = new ReadableStream({
    cancel() { disconnected = true; },
    async start(controller) {
      const send = (event: AgentEvent) => {
        const isPi = event.type === "pi_event", link = event.type === "entry_link";
        const encoded = encoder.encode(`${JSON.stringify({ sessionId, runId: turnId, sequence: ++sequence, type: isPi ? event.piType : event.type, entryId: link ? event.entryId : null, temporaryId: isPi || link ? event.temporaryId : null, payload: isPi ? event.payload : event })}\n`);
        if (!disconnected) { try { controller.enqueue(encoded); } catch { disconnected = true; } }
        if (!firstTextLogged && event.type === "message_delta" && event.text) {
          firstTextLogged = true;
          logStage("first_text_enqueued");
        }
        if (event.type === "complete") logStage("complete_enqueued");
      };
      try {
        for await (const event of source) send(event);
      } catch (error) {
        send({
          type: "error",
          code: "STREAM_ERROR",
          message: "消息流失败，请重新读取会话树",
          recoverable: true,
        });
      } finally { if (!disconnected) controller.close(); }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
