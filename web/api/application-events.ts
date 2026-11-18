type Listener = { data: (value: unknown) => void; error: (message: string) => void };
const resources = new Map<string, Set<Listener>>();
const latest = new Map<string, unknown>();
let source: EventSource | null = null, scheduled: ReturnType<typeof setTimeout> | undefined, connectedKey = '', needsSnapshot = false;

/** One multiplexed connection per page, including React Strict Mode's effect replay. */
function scheduleConnection(refresh = false) {
  needsSnapshot ||= refresh;
  if (scheduled) clearTimeout(scheduled);
  scheduled = setTimeout(() => {
    scheduled = undefined;
    for(const key of latest.keys())if(!resources.has(key))latest.delete(key);
    const key=JSON.stringify([...resources.keys()].sort());
    if(!needsSnapshot&&source&&connectedKey===key&&source.readyState!==2)return;
    needsSnapshot=false;
    source?.close(); source = null;connectedKey=key;
    if (!resources.size) return;
    const connection = new EventSource(`/api/events?${new URLSearchParams({ resources: key })}`);
    source = connection;
    connection.addEventListener('snapshot', message => {
      if (source !== connection) return;
      try {
        const frame = JSON.parse((message as MessageEvent).data) as {resource:string;data:unknown};
        latest.set(frame.resource,frame.data);
        for (const listener of resources.get(frame.resource) ?? []) listener.data(frame.data);
      } catch { for (const listeners of resources.values()) for (const listener of listeners) listener.error('无法解析服务端推送'); }
    });
    connection.addEventListener('resource_error', message => {
      if (source !== connection) return;
      try { const frame = JSON.parse((message as MessageEvent).data); latest.delete(frame.resource); for (const listener of resources.get(frame.resource) ?? []) listener.error(frame.error?.message ?? '无法同步资源'); }
      catch { /* Connection errors are reported separately. */ }
    });
    connection.onerror = () => {
      if (source !== connection) return;
      latest.clear();
      for (const listeners of resources.values()) for (const listener of listeners) listener.error('服务端推送已断开，正在重新连接');
      // Native EventSource reconnects and receives fresh snapshots; never poll GETs.
    };
  }, 0);
}
export function subscribeApplicationResource<T>(resource: string, onData: (value: T) => void, onError: (message: string) => void) {
  const listener: Listener = { data: value => onData(value as T), error: onError };
  let listeners = resources.get(resource);
  if (!listeners) { listeners = new Set(); resources.set(resource, listeners); scheduleConnection(!latest.has(resource)); }
  listeners.add(listener);
  if(latest.has(resource))listener.data(latest.get(resource));
  return () => {
    const current = resources.get(resource); current?.delete(listener);
    if (current?.size === 0) { resources.delete(resource); scheduleConnection(); }
  };
}
