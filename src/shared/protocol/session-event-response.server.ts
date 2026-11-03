import type { SessionEvents } from "@/application/session-events";

export function sessionEventResponse(request: Request, events: SessionEvents, sessionId: string, leaseId: string) {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let ended = false;
  const close = () => { if (ended) return; ended = true; unsubscribe?.(); request.signal.removeEventListener("abort", close); };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const end = () => { close(); try { controller.close(); } catch { /* already disconnected */ } };
      unsubscribe = events.subscribe(sessionId, leaseId, frame => {
        if (!ended) controller.enqueue(encoder.encode(`event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`));
      }, end);
      request.signal.addEventListener("abort", end, { once: true });
      // Save exact callback so cleanup removes the abort listener too.
      unsubscribe = ((release) => () => { request.signal.removeEventListener("abort", end); release(); })(unsubscribe);
      if (request.signal.aborted) end();
    },
    cancel: close,
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
}
