import {useCallback,useEffect,useRef,useState} from "react";
import {api} from "../../../api/client";
import type {SessionMemoryView} from "../../../domain/session-memory";
import {createAdaptivePoller,memoryPollingDelay} from "./session-memory-polling";

export function useSessionMemory(projectId:string|null,sessionId:string|null,panelVisible:boolean,running:boolean) {
  const [view,setView]=useState<SessionMemoryView|null>(null),[error,setError]=useState("");
  const current=useRef<SessionMemoryView|null>(null),failed=useRef(false),followUntil=useRef(0);
  const visible=useRef(panelVisible);visible.current=panelVisible;
  const poller=useRef<ReturnType<typeof createAdaptivePoller<SessionMemoryView>>|null>(null);
  const accept=useCallback((result:SessionMemoryView)=>{current.current=result;failed.current=false;setError("");setView(result);poller.current?.reschedule();},[]);
  const refresh=useCallback(()=>poller.current?.refresh()??Promise.resolve(),[]);
  useEffect(()=>{
    current.current=null;failed.current=false;followUntil.current=0;setView(null);setError("");
    if(!projectId||!sessionId)return;
    const loop=createAdaptivePoller({request:()=>api.getSessionMemory(projectId,sessionId),receive:accept,error:(cause)=>{failed.current=true;setError(cause instanceof Error?cause.message:"无法读取记忆同步状态");},delay:()=>memoryPollingDelay(current.current,visible.current,followUntil.current,Date.now(),failed.current),visible:()=>!document.hidden});
    poller.current=loop;void loop.refresh();
    const show=()=>{if(document.hidden)loop.pause();else void loop.refresh();};
    const saved=(event:Event)=>{if((event as CustomEvent<{projectId:string}>).detail.projectId===projectId)void loop.refresh();};
    document.addEventListener("visibilitychange",show);window.addEventListener("session-memory-saved",saved);
    return()=>{loop.dispose();if(poller.current===loop)poller.current=null;document.removeEventListener("visibilitychange",show);window.removeEventListener("session-memory-saved",saved);};
  },[projectId,sessionId,accept]);
  const prior=useRef({panelVisible,running});
  useEffect(()=>{
    const previous=prior.current;prior.current={panelVisible,running};
    if(previous.running&&!running){followUntil.current=Date.now()+5000;void refresh();}
    else if(panelVisible&&!previous.panelVisible)void refresh();
    else if(!panelVisible&&previous.panelVisible)poller.current?.reschedule();
  },[panelVisible,running,refresh]);
  return {view,error,refresh,accept};
}
