import "server-only";

import type { RoomRunEvent } from "@/domain/room-run-events";

export function roomRunEventStreamResponse(roomId: string, source: AsyncGenerator<RoomRunEvent>) {
  const encoder = new TextEncoder();
  const runId = crypto.randomUUID();
  let sequence = 0;
  return new Response(new ReadableStream({
    async start(controller) {
      try {
        for await (const event of source) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ eventId: crypto.randomUUID(), runId, roomId, sequence: ++sequence, emittedAt: new Date().toISOString(), event })}\n`));
        }
      } catch {
        controller.enqueue(encoder.encode(`${JSON.stringify({ eventId: crypto.randomUUID(), runId, roomId, sequence: ++sequence, emittedAt: new Date().toISOString(), event: { type: "error", code: "STREAM_ERROR", message: "请求流失败", recoverable: true } })}\n`));
      } finally { controller.close(); }
    },
  }), { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
}
