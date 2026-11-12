import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeSession, submitSessionMessage, submitSessionSteer, SessionMessageError, type SessionLease } from "../../api/session-events";
import type { PiStreamEvent, SessionTree } from "../../domain/models";
import { sessionContextFilesRequest } from "../../api/session-context-files";
import type { SessionContextFilesView } from "../../../src/application/ports/session-context-files";

import type { SessionRunMetrics } from '../../../src/domain/session-run-metrics';

export type TemporaryNode = { key: string; entryId: string | null; events: PiStreamEvent[] };
const empty: SessionTree = { entries: [], activeLeafId: null };
export function useSessionTree(base: string | null, read: () => Promise<SessionTree>, changed?: () => Promise<void>) {
  const [tree, setTree] = useState<SessionTree>(empty), [temporary, setTemporary] = useState<TemporaryNode[]>([]);
  const [ready, setReady] = useState(false), [running, setRunning] = useState(false), [error, setError] = useState("");
  const [connection,setConnection]=useState<'open'|'closed'>('closed'),[compacting,setCompacting]=useState(false),[eventRevision,setEventRevision]=useState(0),[closed,setClosed]=useState(false);
  const [steeringQueue,setSteeringQueue]=useState<string[]>([]);
  const [runMetrics,setRunMetrics]=useState<SessionRunMetrics|null>(null);
  const metricsRequest=useRef<string|null>(null);
  const [contextFiles,setContextFiles]=useState<SessionContextFilesView>({files:[],writeETag:""});
  const [contextReady,setContextReady]=useState(false);
  const contextRef=useRef(contextFiles);contextRef.current=contextFiles;
  const contextMutation=useRef(false);
  const [pendingText, setPendingText] = useState(""), [retry, setRetry] = useState(0);
  const lease = useRef<SessionLease | null>(null), readRef = useRef(read), changedRef = useRef(changed);
  const refreshRef = useRef<() => Promise<void>>(async () => {}), currentBase = useRef(base);
  readRef.current = read; changedRef.current = changed; currentBase.current = base;
  useEffect(()=>{setTree(empty);setTemporary([]);setClosed(false);setContextFiles({files:[],writeETag:''});setContextReady(false);},[base]);
  useEffect(() => {
    setContextReady(false);
    setRunMetrics(null);metricsRequest.current=null;
    setTemporary([]); setSteeringQueue([]); setPendingText(""); setReady(false); setRunning(false); setError(""); lease.current = null;
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
            const [snapshot,files] = await Promise.all([readRef.current(),sessionContextFilesRequest(base)]);
            if (disposed) return;
            setContextFiles(files);setContextReady(true);
            setTree(snapshot);
            const ids = new Set(snapshot.entries.map(item => item.entry.id));
            setTemporary(items => items.filter(item => !item.entryId || !ids.has(item.entryId)));
            await changedRef.current?.();
          } catch (cause) { if (!disposed) {setContextReady(false);setError(cause instanceof Error ? cause.message : "无法同步 Pi 历史或参考文件");} }
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
      if(event.type==='run_started'){metricsRequest.current=(event.payload as {requestId:string}).requestId;setRunMetrics(null);return;}
      if(event.type==='run_metrics'){const metrics=event.payload as SessionRunMetrics;if(metricsRequest.current===metrics.requestId)setRunMetrics(metrics);return;}
      if(event.type==='queue_update'){const payload=event.payload as {steering?:string[]};setSteeringQueue(payload.steering??[]);return;}
      if(event.type==='steering_cleared'){setSteeringQueue([]);setError('运行已结束，未消费的纠正已清除；如仍需要，请重新发送。');return;}
      if(event.type==='thinking_level_changed'){setEventRevision(n=>n+1);void refresh();return;}
      if(event.type==='context_changed'){setCompacting(false);setEventRevision(n=>n+1);void refresh();return;}
      if(event.type==='compaction_start'){setCompacting(true);setEventRevision(n=>n+1);return;}
      if(event.type==='compaction_end'){setCompacting(false);setEventRevision(n=>n+1);void refresh();return;}
      if (event.type === "error") { setError((event.payload as { message?: string }).message ?? "会话执行失败"); setRunning(false); setSteeringQueue([]); void refresh(); return; }
      if (event.type === "session_state") { const state = (event.payload as { state?: string }).state; const active=["starting", "running", "interrupting"].includes(state ?? "");setRunning(active);return; }
      if (event.type === "agent_start") { setRunning(true); return; }
      if (["complete", "agent_settled"].includes(event.type)) { setRunning(false);setSteeringQueue([]);setEventRevision(n=>n+1); void refresh(); return; }
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
      onReady: async opened => { if (disposed) return; lease.current = opened; setConnection('open');setReady(opened.status !== "unavailable"); setRunning(opened.activity?.running??opened.status === "running");setCompacting(opened.activity?.compacting??false);setSteeringQueue(opened.activity?.steering??[]);setEventRevision(n=>n+1); setError(opened.outcome === "SESSION_BACKGROUND_TIMEOUT" ? "会话离开后运行超时并已停止" : opened.outcome === "REQUEST_UNKNOWN" ? "此前请求结果待核对。请打开检查面板核对 Pi 历史；确认后可解除阻塞。" : ""); await refresh(); },
      onEvent: receive,
      onError: cause => { if (!disposed) setError(cause.message); },
      onDisconnect: () => { if (!disposed) { lease.current = null;setConnection('closed'); setReady(false); } },
      onClosed:()=>{if(!disposed)setClosed(true);},
    });
    return () => { disposed = true; disconnect(); lease.current = null; refreshRef.current = async () => {}; };
  }, [base, retry,closed]);
  const send = useCallback(async (content: string, references?: import("../../../src/domain/message-references").MessageReference[], webSearch?: boolean, toolSearch?: boolean) => {
    const opened = lease.current, selected = currentBase.current;
    if (!base || base !== selected || !opened || !contextReady || contextMutation.current) throw new Error("请先连接会话并等待参考文件加载或保存完成");
    if(running&&references?.length)throw new Error('运行中仅支持文字纠正，请移除附件后发送');
    if(!running){setPendingText(content);setRunMetrics(null);metricsRequest.current=null;}setError('');
    try {
      if(running)await submitSessionSteer(base,opened.leaseId,content);
      else await submitSessionMessage(base, opened.leaseId, content, references, webSearch, toolSearch);
    }
    catch (cause) {
      if (currentBase.current === selected) {
        setPendingText("");
        if(cause instanceof SessionMessageError && ['RUNTIME_NOT_OPEN','RUNTIME_LEASE_EXPIRED'].includes(cause.code??'') && lease.current?.leaseId===opened.leaseId){
          lease.current=null;setReady(false);setConnection('closed');setError('会话连接已失效，正在重新连接；输入和文件已保留，请连接恢复后重新发送。');setRetry(n=>n+1);
        }
      }
      throw cause;
    }
  }, [base,running,contextReady]);
  async function changeContextFiles(method:'POST'|'DELETE',value:import('../../../src/domain/message-references').MessageReference[]|string) {
    const selected=base,opened=lease.current;
    if(!selected||selected!==currentBase.current||!opened||!contextReady)throw new Error('请先连接并加载参考文件');
    if(contextMutation.current)throw new Error('参考文件正在保存，请稍后重试');
    contextMutation.current=true;
    try{
      const result=await sessionContextFilesRequest(selected,method,{lease:opened.leaseId,etag:contextRef.current.writeETag,...(method==='POST'?{references:value as import('../../../src/domain/message-references').MessageReference[]}:{id:value as string})});
      if(currentBase.current===selected){contextRef.current=result;setContextFiles(result);}
    }catch(error){
      if(currentBase.current===selected){
        try{const result=await sessionContextFilesRequest(selected);if(currentBase.current===selected){contextRef.current=result;setContextFiles(result);}}catch{setContextReady(false);}
      }
      throw error;
    }finally{contextMutation.current=false;}
  }
  return { tree, temporary, steeringQueue, runMetrics, contextFiles:contextFiles.files, addContextFiles:(items:import('../../../src/domain/message-references').MessageReference[])=>changeContextFiles('POST',items),removeContextFile:(id:string)=>changeContextFiles('DELETE',id),ready:ready&&contextReady,connection,compacting,eventRevision,close:()=>setClosed(true), leaseId: lease.current?.leaseId ?? null, running, setRunning, pendingText, error, setError, send, refresh: useCallback(() => refreshRef.current(), []), retryOpen: () => {setClosed(false);setRetry(n => n + 1);} };
}
