import type {SessionMemoryView} from "../../../domain/session-memory";

export function memoryPollingDelay(view:SessionMemoryView|null,panelVisible:boolean,followUntil:number,now=Date.now(),failed=false):number|null {
  if(failed||view?.syncState==="failed"||view?.syncState==="unavailable")return panelVisible?30000:null;
  if(now<followUntil||!view||view.syncState==="updating"||view.syncState==="pending")return 2000;
  return panelVisible?30000:null;
}

/** Single completion-driven request chain, including manual refresh and visibility wakes. */
export function createAdaptivePoller<T>(options:{request:()=>Promise<T>;receive:(value:T)=>void;error:(cause:unknown)=>void;delay:()=>number|null;visible:()=>boolean;setTimer?:typeof setTimeout;clearTimer?:typeof clearTimeout}) {
  const setTimer=options.setTimer??setTimeout,clearTimer=options.clearTimer??clearTimeout;
  let timer:ReturnType<typeof setTimeout>|undefined,pending:Promise<void>|null=null,disposed=false;
  const clear=()=>{if(timer!==undefined)clearTimer(timer);timer=undefined;};
  function plan(){clear();if(disposed||pending||!options.visible())return;const delay=options.delay();if(delay!==null)timer=setTimer(()=>{timer=undefined;void refresh();},delay);}
  function refresh():Promise<void>{
    if(disposed||!options.visible()){clear();return Promise.resolve();}
    if(pending)return pending;
    clear();
    pending=Promise.resolve().then(options.request).then(value=>{if(!disposed)options.receive(value);},cause=>{if(!disposed)options.error(cause);}).finally(()=>{pending=null;plan();});
    return pending;
  }
  return {refresh,pause:clear,reschedule:plan,dispose(){disposed=true;clear();}};
}
