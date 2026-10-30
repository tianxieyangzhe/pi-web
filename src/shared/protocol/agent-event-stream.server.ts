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
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify({
          eventId: crypto.randomUUID(),
          turnId,
          sessionId,
          sequence: ++sequence,
          emittedAt: new Date().toISOString(),
          event,
        })}\n`));
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
          message: error instanceof Error ? error.message : "消息流失败",
          recoverable: true,
        });
      } finally { controller.close(); }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
