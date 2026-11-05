import { randomUUID } from "./random-uuid";
import type { PiStreamEvent } from "../domain/models";

export type SessionLease = { leaseId: string; status: string; outcome: string | null;activity?:{running:boolean;compacting:boolean} };
async function mutation(base: string, action: string, body?: unknown, keepalive = false) {
  const response = await fetch(`${base}/runtime/${action}`, { method: "POST", cache: "no-store", keepalive, headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) { const payload = await response.json(); throw new Error(payload.error?.message ?? "会话订阅失败"); }
  return response.status === 204 ? null : (await response.json()).data;
}

/** Browser only responds to server ping; reconnect timers never renew presence. */
export function subscribeSession(base: string, options: { onReady: (lease: SessionLease) => void | Promise<void>; onEvent: (event: PiStreamEvent) => void; onError: (error: Error) => void; onDisconnect?: () => void;onClosed?:()=>void }) {
  let disposed = false, source: EventSource | null = null, lease: SessionLease | null = null;
  let reconnect: ReturnType<typeof setTimeout> | undefined, generation = 0;
  const release = () => {
    source?.close(); source = null;
    const old = lease; lease = null;
    if (old) void mutation(base, "close", { leaseId: old.leaseId }, true).catch(() => {});
  };
  const fail = (error: Error, version: number) => {
    if (disposed || version !== generation) return;
    ++generation; release(); options.onDisconnect?.(); options.onError(error);
    reconnect = setTimeout(() => { void connect(); }, 2000);
  };
  const connect = async () => {
    const version = ++generation;
    try {
      const opened: SessionLease = await mutation(base, "open");
      if (disposed || version !== generation) { void mutation(base, "close", { leaseId: opened.leaseId }, true); return; }
      lease = opened;
      const events = new EventSource(`${base}/events?${new URLSearchParams({ leaseId: opened.leaseId })}`); source = events;
      events.addEventListener("ready", message => {
        if (disposed || version !== generation) return;
        const frame=JSON.parse((message as MessageEvent|undefined)?.data??'{}');
        void Promise.resolve(options.onReady({...opened,activity:frame.activity??undefined})).catch(error => { if (!disposed && version === generation) options.onError(error instanceof Error ? error : new Error("历史同步失败")); });
      });
      events.addEventListener("ping", message => {
        if (disposed || version !== generation) return;
        try { const pong = JSON.parse((message as MessageEvent).data); void mutation(base, "pong", pong).catch(error => fail(error, version)); }
        catch { fail(new Error("无效的会话心跳"), version); }
      });
      events.onmessage = message => {
        if (disposed || version !== generation) return;
        try { const event=JSON.parse(message.data);if(event.type==="session_closed"){disposed=true;++generation;release();options.onDisconnect?.();options.onClosed?.();return;}options.onEvent(event); } catch { fail(new Error("无法解析会话事件，请重新同步"), version); }
      };
      events.onerror = () => fail(new Error("会话订阅已断开，正在重新连接"), version);
    } catch (error) { fail(error instanceof Error ? error : new Error("无法订阅会话"), version); }
  };
  void connect();
  return () => { disposed = true; ++generation; if (reconnect) clearTimeout(reconnect); release(); };
}

export async function submitSessionMessage(base: string, leaseId: string, content: string, references?: import("../../src/domain/message-references").MessageReference[]) {
  const response = await fetch(`${base}/messages`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "idempotency-key": randomUUID(), "x-session-lease-id": leaseId }, body: JSON.stringify({ content, references }) });
  if (!response.ok) { const payload = await response.json(); throw new Error(payload.error?.message ?? "消息提交失败"); }
  return (await response.json()).data;
}
