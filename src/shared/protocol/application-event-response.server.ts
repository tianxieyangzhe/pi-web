import { applicationChanges, type ApplicationChange } from '@/application/application-changes';
import { DomainError } from '@/domain/errors';
export type ResourceSubscription = { read: () => unknown | Promise<unknown>; matches: (change: ApplicationChange) => boolean };
export function applicationEventResponse(request: Request, resolve: (resource: string) => ResourceSubscription) {
  let resources: unknown;
  try { resources = JSON.parse(new URL(request.url).searchParams.get('resources') ?? 'null'); } catch { /* Invalid input handled below. */ }
  if (!Array.isArray(resources) || resources.length < 1 || resources.length > 64 || resources.some(value => typeof value !== 'string' || value.length > 512)) throw new DomainError('INVALID_INPUT', '订阅资源无效', 400, true);
  const subscriptions = [...new Set(resources as string[])].map(resource => ({ resource, ...resolve(resource) }));
  const encoder = new TextEncoder();
  let ended = false, unsubscribe: (() => void) | undefined, heartbeat: ReturnType<typeof setInterval> | undefined, scheduled: ReturnType<typeof setImmediate> | undefined;
  let finish: (() => void) | undefined;
  const pending = new Set(subscriptions);
  const lastSent = new Map<string,string>();
  const close = () => {
    if (ended) return; ended = true; unsubscribe?.(); pending.clear();
    if (heartbeat) clearInterval(heartbeat); if (scheduled) clearImmediate(scheduled);
    request.signal.removeEventListener('abort', abort);
  };
  const abort = () => { close(); finish?.(); };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      finish = () => { try { controller.close(); } catch { /* Already closed. */ } };
      const send = (event: string, data: unknown) => {
        if (ended) return;
        if ((controller.desiredSize ?? 0) < -64) { abort(); return; }
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { abort(); }
      };
      let reading = false;
      const flush = async () => {
        scheduled = undefined;
        if (ended || reading) return;
        reading = true;
        try {
          while (!ended && pending.size) {
            const batch = [...pending]; pending.clear();
            for (const subscription of batch) {
              if(ended)break;
              try {
                const data = await subscription.read(), encoded=JSON.stringify(data);
                if(lastSent.get(subscription.resource)!==encoded){lastSent.set(subscription.resource,encoded);send('snapshot', { resource: subscription.resource, data });}
              }
              catch (error) { lastSent.delete(subscription.resource);send('resource_error', { resource: subscription.resource, error: { code: error instanceof DomainError ? error.code : 'READ_FAILED', message: error instanceof DomainError ? error.message : '无法同步资源' } }); }
            }
          }
        } finally { reading = false; }
      };
      unsubscribe = applicationChanges.subscribe(change => {
        for (const subscription of subscriptions) if (subscription.matches(change)) pending.add(subscription);
        if (!reading && pending.size && !scheduled) scheduled = setImmediate(() => { void flush(); });
      });
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) { abort(); return; }
      void flush();
      heartbeat = setInterval(() => { if (!ended) { if((controller.desiredSize??0)<-64){abort();return;}try { controller.enqueue(encoder.encode(': keepalive\n\n')); } catch { abort(); } } }, 30_000);
      heartbeat.unref?.();
    },
    cancel: close,
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no' } });
}
