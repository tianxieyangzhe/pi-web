import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeSession, submitSessionMessage, type SessionLease } from "../../api/session-events";
import type { PiStreamEvent, SessionTree } from "../../domain/models";

export type TemporaryNode = { key: string; entryId: string | null; events: PiStreamEvent[] };
const empty: SessionTree = { entries: [], activeLeafId: null };
export function useSessionTree(base: string | null, read: () => Promise<SessionTree>, changed?: () => Promise<void>) {
  const [tree, setTree] = useState<SessionTree>(empty), [temporary, setTemporary] = useState<TemporaryNode[]>([]);
  const [ready, setReady] = useState(false), [running, setRunning] = useState(false), [error, setError] = useState("");
  const [pendingText, setPendingText] = useState(""), [retry, setRetry] = useState(0);
  const lease = useRef<SessionLease | null>(null), readRef = useRef(read), changedRef = useRef(changed);
  const refreshRef = useRef<() => Promise<void>>(async () => {}), currentBase = useRef(base);
  readRef.current = read; changedRef.current = changed; currentBase.current = base;
  useEffect(() => {
    setTree(empty); setTemporary([]); setPendingText(""); setReady(false); setRunning(false); setError(""); lease.current = null;
    if (!base) return;
    let disposed = false, sync: Promise<void> | null = null, again = false;
    const seen = new Map<string, number>();
    const refresh = (): Promise<void> => {
      if (disposed) return Promise.resolve();
      if (sync) { again = true; return sync; }
      sync = (async () => {
        do {
          again = false;
          try {
            const snapshot = await readRef.current();
            if (disposed) return;
            setTree(snapshot);
            const ids = new Set(snapshot.entries.map(item => item.entry.id));
            setTemporary(items => items.filter(item => !item.entryId || !ids.has(item.entryId)));
            await changedRef.current?.();
          } catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : "无法同步 Pi 历史"); }
        } while (again && !disposed);
      })().finally(() => { sync = null; });
      return sync;
    };
    refreshRef.current = refresh;
    const receive = (event: PiStreamEvent) => {
      if (disposed || !event || event.sessionId !== base.split("/").at(-1)) return;
      if (event.runId && event.sequence !== null) {
        if (event.sequence <= (seen.get(event.runId) ?? 0)) return;
        seen.set(event.runId, event.sequence);
      }
      if (event.type === "error") { setError((event.payload as { message?: string }).message ?? "会话执行失败"); setRunning(false); void refresh(); return; }
      if (event.type === "session_state") { const state = (event.payload as { state?: string }).state; setRunning(["starting", "running", "interrupting"].includes(state ?? "")); return; }
      if (event.type === "agent_start") { setRunning(true); return; }
      if (["complete", "agent_settled"].includes(event.type)) { setRunning(false); void refresh(); return; }
      if (event.type === "project_call") { void changedRef.current?.().catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : "无法同步项目调用"); }); return; }
      if (event.type === "entry_link" && event.temporaryId && event.entryId) {
        const key = `${event.runId}:${event.temporaryId}`;
        setTemporary(items => items.map(item => item.key === key ? { ...item, entryId: event.entryId } : item));
        void refresh(); return;
      }
      if (["message_delta", "activity", "response_reset", "project_changes", "agent_end", "turn_start", "turn_end"].includes(event.type)) return;
      if (event.type === "message_start" && (event.payload as { message?: { role?: string } }).message?.role === "user") setPendingText("");
      const key = `${event.runId}:${event.temporaryId ?? `event-${event.sequence}`}`;
      setTemporary(items => {
        const index = items.findIndex(item => item.key === key);
        return index < 0 ? [...items, { key, entryId: null, events: [event] }] : items.map((item, i) => i === index ? { ...item, events: [...item.events, event] } : item);
      });
    };
    const disconnect = subscribeSession(base, {
      onReady: async opened => { if (disposed) return; lease.current = opened; setReady(true); setRunning(opened.status === "running"); setError(opened.outcome === "SESSION_BACKGROUND_TIMEOUT" ? "会话离开后运行超时并已停止" : ""); await refresh(); },
      onEvent: receive,
      onError: cause => { if (!disposed) setError(cause.message); },
      onDisconnect: () => { if (!disposed) { lease.current = null; setReady(false); } },
    });
    return () => { disposed = true; disconnect(); lease.current = null; refreshRef.current = async () => {}; };
  }, [base, retry]);
  const send = useCallback(async (content: string, references?: import("../../../src/domain/message-references").MessageReference[]) => {
    const opened = lease.current, selected = currentBase.current;
    if (!base || base !== selected || !opened) throw new Error("请先连接会话");
    setPendingText(content); setRunning(true); setError("");
    try { await submitSessionMessage(base, opened.leaseId, content, references); }
    catch (cause) { if (currentBase.current === selected) { setPendingText(""); setRunning(false); } throw cause; }
  }, [base]);
  return { tree, temporary, ready, running, setRunning, pendingText, error, setError, send, refresh: useCallback(() => refreshRef.current(), []), retryOpen: () => setRetry(n => n + 1) };
}
