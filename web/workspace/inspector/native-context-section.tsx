import { ErrorToast } from '../conversation/error-toast';
import {Button} from '../../components/button';
import {useCallback,useEffect,useRef,useState} from "react";
import {api} from "../../api/client";
import type {NativeContextInspection} from "../../domain/native-context";

const stateLabels={not_started:"未启动",starting:"正在启动",idle:"空闲",running:"正在回答",interrupting:"正在停止",ended:"无运行任务",unavailable:"需要恢复"};
export type NativeContextApi = {inspect:()=>Promise<NativeContextInspection>;compact:()=>Promise<NativeContextInspection>;cancel:()=>Promise<NativeContextInspection>};
export function NativeContextSection({projectId,sessionId,onBusy,onRestore,running,contextApi,eventRevision=0}:{projectId:string;sessionId:string|null;onBusy:(busy:boolean)=>void;onRestore:()=>Promise<void>;running:boolean;contextApi?:NativeContextApi;eventRevision?:number}) {
  const [value,setValue]=useState<NativeContextInspection|null>(null);
  const [error,setError]=useState("");
  const [pending,setPending]=useState<"refresh"|"compact"|"cancel"|"restore"|null>(null);
  const identity=useRef(`${projectId}:${sessionId}`);identity.current=`${projectId}:${sessionId}`;
  const mounted=useRef(false);
  const sequence=useRef(0);
  const accept=useCallback((result:NativeContextInspection)=>{setValue(result);onBusy(result.compactionState==="running");},[onBusy]);
  const refresh=useCallback(async()=>{if(!sessionId)return;const version=++sequence.current,key=identity.current;try{const result=await (contextApi?contextApi.inspect():api.getNativeContext(projectId,sessionId));if(mounted.current&&key===identity.current&&version===sequence.current){accept(result);setError('');}}catch(cause){if(mounted.current&&version===sequence.current)setError(cause instanceof Error?cause.message:'无法读取上下文');}},[projectId,sessionId,contextApi,accept]);
  useEffect(()=>{mounted.current=true;setValue(null);setError('');setPending(null);void refresh();return()=>{mounted.current=false;sequence.current++;};},[refresh]);
  useEffect(()=>{if(eventRevision)void refresh();},[eventRevision,refresh]);
  const wasRunning=useRef(running);
  useEffect(()=>{if(wasRunning.current&&!running)void refresh();wasRunning.current=running;},[running,refresh]);
  async function act(action:"refresh"|"compact"|"cancel"|"restore"){
    if(!sessionId||pending)return;
    const key=`${projectId}:${sessionId}`,version=++sequence.current;setPending(action);setError("");
    try{
      if(action==="refresh"){await refresh();return;}
      if(action==="restore"){await onRestore();await refresh();return;}
      const result=contextApi?await (action==='compact'?contextApi.compact():contextApi.cancel()):action==="compact"?await api.compactNativeContext(projectId,sessionId):await api.cancelNativeCompaction(projectId,sessionId);
      if(mounted.current&&identity.current===key&&version===sequence.current){accept(result);}
    }catch(cause){if(mounted.current&&identity.current===key)setError(cause instanceof Error?cause.message:"Pi 上下文操作失败");}
    finally{if(mounted.current&&identity.current===key)setPending(null);}
  }
  const usage=value?.usage;
  const number=(n:number|null|undefined)=>n==null?"未知":n.toLocaleString("zh-CN");
  const ratio=usage?.usageRatio;
  const status=value?.compactionState==="running"?(value.canCancelCompaction?"正在压缩":"正在取消或准备压缩"):value?.compactionState==="cancelled"?"压缩已取消":value?.compactionState==="failed"?"压缩失败":value?stateLabels[value.sessionState]:sessionId?"读取中":"未创建会话";
  return <section className="session-inspector__section pi-context-section"><h2>Pi 上下文</h2>
    <div className="session-inspector__row"><span>运行活动</span><b>{status}</b></div>
    <div className="session-inspector__row"><span>已用 Token</span><b>{number(usage?.usedTokens)}</b></div>
    <div className="session-inspector__row"><span>模型容量</span><b>{number(usage?.contextWindowTokens)}</b></div>
    <div className="session-inspector__row"><span>剩余 Token</span><b>{number(usage?.remainingTokens)}</b></div>
    {ratio!=null&&<><progress max={1} value={Math.min(1,Math.max(0,ratio))} aria-label="Pi 上下文占用"/><p>{(ratio*100).toFixed(1)}%{ratio>=1?" · 上下文已满，Pi 将按原生策略自动压缩":ratio>=.8?" · 可手动压缩减少占用":""}</p></>}
    <div className="session-inspector__row"><span>测量口径</span><b>{error?"最新状态读取失败":usage?.measurement==="estimated"?"Pi 估算":usage?.measurement==="native"?"原生采样":"暂不可用"}</b></div>
    {usage?.measuredAt&&<div className="session-inspector__row"><span>{error||usage.freshness==="last_known"?"上次采样":"采样时间"}</span><b>{new Date(usage.measuredAt).toLocaleTimeString("zh-CN")}</b></div>}
    <div className="session-inspector__row"><span>压缩策略</span><b>{value ? value.autoCompactionEnabled ? "自动压缩 · Pi 默认" : "自动压缩未启用" : "读取中…"}</b></div>
    <div className="session-inspector__row"><span>最近压缩</span><b>{value?.lastCompactedAt?new Date(value.lastCompactedAt).toLocaleString("zh-CN"):"尚无记录"}</b></div>
    <div className="pi-context-section__actions">
      <Button className="session-inspector__action" disabled={!sessionId||!!pending} onClick={()=>void act("refresh")}>{pending==="refresh"?"刷新中…":"刷新"}</Button>
      {value?.compactionState==="running"?<Button className="session-inspector__action" disabled={!!pending||!value.canCancelCompaction} onClick={()=>void act("cancel")}>{pending==="cancel"?"正在取消…":"取消压缩"}</Button>:<Button className="session-inspector__action" disabled={!!pending||!value?.canCompact} title={value?.unavailableReason??""} onClick={()=>void act("compact")}>{pending==="compact"?"准备压缩…":"压缩上下文"}</Button>}
      {value?.sessionState==="unavailable"&&<Button className="session-inspector__action" disabled={!!pending} onClick={()=>void act("restore")}>{pending==="restore"?"恢复中…":"恢复会话"}</Button>}
    </div>
    {(!value?.canCompact||!value.runtimeReady)&&value?.compactionState!=="running"&&<p className="session-inspector__note">{value?.unavailableReason??"发送首条消息后可管理"}</p>}
    <p className="session-inspector__note">Pi 管理当前对话窗口。压缩调用模型并保留历史，自动压缩保持开启，参数使用 Pi 默认值；也可手动压缩。</p>
    <ErrorToast message={error||value?.error?.message}/>
  </section>;
}
