import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeSession, submitSessionMessage, SessionMessageError, type SessionLease } from "../../api/session-events";
import type { PiStreamEvent, SessionTree } from "../../domain/models";

export type TemporaryNode = { key: string; entryId: string | null; events: PiStreamEvent[] };
const empty: SessionTree = { entries: [], activeLeafId: null };
export function useSessionTree(base: string | null, read: () => Promise<SessionTree>, changed?: () => Promise<void>) {
  const [tree, setTree] = useState<SessionTree>(empty), [temporary, setTemporary] = useState<TemporaryNode[]>([]);
  const [ready, setReady] = useState(false), [running, setRunning] = useState(false), [error, setError] = useState("");
  const [connection,setConnection]=useState<'open'|'closed'>('closed'),[compacting,setCompacting]=useState(false),[eventRevision,setEventRevision]=useState(0),[closed,setClosed]=useState(false);
  const [pendingText, setPendingText] = useState(""), [retry, setRetry] = useState(0);
  const lease = useRef<SessionLease | null>(null), readRef = useRef(read), changedRef = useRef(changed);
  const refreshRef = useRef<() => Promise<void>>(async () => {}), currentBase = useRef(base);
  readRef.current = read; changedRef.current = changed; currentBase.current = base;
  useEffect(()=>{setTree(empty);setTemporary([]);setClosed(false);},[base]);
  useEffect(() => {
    setTemporary([]); setPendingText(""); setReady(false); setRunning(false); setError(""); lease.current = null;
    setConnection('closed');setCompacting(false);
    if (!base||closed) return;
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
      if(event.type==='thinking_level_changed'){setEventRevision(n=>n+1);void refresh();return;}
      if(event.type==='context_changed'){setCompacting(false);setEventRevision(n=>n+1);void refresh();return;}
      if(event.type==='compaction_start'){setCompacting(true);setEventRevision(n=>n+1);return;}
      if(event.type==='compaction_end'){setCompacting(false);setEventRevision(n=>n+1);void refresh();return;}
      if (event.type === "error") { setError((event.payload as { message?: string }).message ?? "会话执行失败"); setRunning(false); void refresh(); return; }
      if (event.type === "session_state") { const state = (event.payload as { state?: string }).state; setRunning(["starting", "running", "interrupting"].includes(state ?? "")); return; }
      if (event.type === "agent_start") { setRunning(true); return; }
      if (["complete", "agent_settled"].includes(event.type)) { setRunning(false);setEventRevision(n=>n+1); void refresh(); return; }
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
      onReady: async opened => { if (disposed) return; lease.current = opened; setConnection('open');setReady(opened.status !== "unavailable"); setRunning(opened.activity?.running??opened.status === "running");setCompacting(opened.activity?.compacting??false);setEventRevision(n=>n+1); setError(opened.outcome === "SESSION_BACKGROUND_TIMEOUT" ? "会话离开后运行超时并已停止" : opened.outcome === "REQUEST_UNKNOWN" ? "此前请求结果待核对。请打开检查面板核对 Pi 历史；确认后可解除阻塞。" : ""); await refresh(); },
      onEvent: receive,
      onError: cause => { if (!disposed) setError(cause.message); },
      onDisconnect: () => { if (!disposed) { lease.current = null;setConnection('closed'); setReady(false); } },
      onClosed:()=>{if(!disposed)setClosed(true);},
    });
    return () => { disposed = true; disconnect(); lease.current = null; refreshRef.current = async () => {}; };
  }, [base, retry,closed]);
  const send = useCallback(async (content: string, references?: import("../../../src/domain/message-references").MessageReference[], webSearch?: boolean, toolSearch?: boolean) => {
    const opened = lease.current, selected = currentBase.current;
    if (!base || base !== selected || !opened) throw new Error("请先连接会话");
    setPendingText(content);setError("");
    try { await submitSessionMessage(base, opened.leaseId, content, references, webSearch, toolSearch); }
    catch (cause) {
      if (currentBase.current === selected) {
        setPendingText("");
        if(cause instanceof SessionMessageError && ['RUNTIME_NOT_OPEN','RUNTIME_LEASE_EXPIRED'].includes(cause.code??'') && lease.current?.leaseId===opened.leaseId){
          lease.current=null;setReady(false);setConnection('closed');setError('会话连接已失效，正在重新连接；输入和文件已保留，请连接恢复后重新发送。');setRetry(n=>n+1);
        }
      }
      throw cause;
    }
  }, [base]);
  return { tree, temporary, ready,connection,compacting,eventRevision,close:()=>setClosed(true), leaseId: lease.current?.leaseId ?? null, running, setRunning, pendingText, error, setError, send, refresh: useCallback(() => refreshRef.current(), []), retryOpen: () => {setClosed(false);setRetry(n => n + 1);} };
}
