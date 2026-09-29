import "server-only";

import type { AgentEvent } from "@/domain/models";

export function agentEventStreamResponse(
  roomId: string | null,
  sessionId: string,
  source: AsyncGenerator<AgentEvent>,
) {
  const encoder = new TextEncoder();
  const turnId = crypto.randomUUID();
  let sequence = 0;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify({
          eventId: crypto.randomUUID(),
          turnId,
          roomId,
          sessionId,
          sequence: ++sequence,
          emittedAt: new Date().toISOString(),
          event,
        })}\n`));
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
