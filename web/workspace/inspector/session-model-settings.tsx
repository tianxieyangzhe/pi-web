import { ErrorToast } from '../conversation/error-toast';
import {Button} from '../../components/button';
import {useEffect,useRef,useState} from 'react';
import type {RecoveryView,SessionModelView,SessionThinkingLevel} from '../../../src/domain/session-tools';
const thinkingLabels:Record<SessionThinkingLevel,string>={off:'关闭',minimal:'最低',low:'低',medium:'中',high:'高',xhigh:'更高',max:'最高'};
export function SessionModelSettings({modelApi,leaseId,onApplied,onRecovered}:{modelApi:{load:()=>Promise<SessionModelView>;apply:(provider:string,modelId:string,thinkingLevel?:SessionThinkingLevel)=>Promise<SessionModelView>;inspectRecovery?:()=>Promise<RecoveryView[]>;acknowledgeRecovery?:(operationId:string)=>Promise<RecoveryView>};leaseId:string|null;onApplied:()=>Promise<void>;onRecovered?:()=>Promise<void>}){
 const [view,setView]=useState<SessionModelView|null>(null),[choice,setChoice]=useState(''),[thinking,setThinking]=useState<SessionThinkingLevel|''>(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [recovery,setRecovery]=useState<RecoveryView[]|null>(null),[confirming,setConfirming]=useState<string|null>(null);
 const generation=useRef(0);
 useEffect(()=>{
  const version=++generation.current;setView(null);setChoice('');setThinking('');setError('');setBusy(false);setRecovery(null);setConfirming(null);
  void modelApi.load().then(value=>{if(version!==generation.current)return;setView(value);setChoice(value.current?.available?JSON.stringify([value.current.provider,value.current.modelId]):'');setThinking(value.thinkingLevel??'');}).catch(cause=>{if(version===generation.current)setError(cause instanceof Error?cause.message:'模型列表读取失败');});
  return()=>{generation.current++;};
 },[modelApi]);
 async function apply(target:'model'|'thinking'){
  if(busy||!view?.canSwitch||!leaseId)return;
  if(target==='model'&&!choice||target==='thinking'&&(!thinking||!view.current?.available))return;
  const version=generation.current;setBusy(true);setError('');
  try{const [provider,modelId]=target==='model'?JSON.parse(choice):[view.current!.provider,view.current!.modelId];const updated=await modelApi.apply(provider,modelId,target==='thinking'?thinking||undefined:undefined);if(version!==generation.current)return;setView(updated);setChoice(updated.current?JSON.stringify([updated.current.provider,updated.current.modelId]):'');setThinking(updated.thinkingLevel??'');await onApplied();}
  catch(cause){if(version===generation.current)setError(cause instanceof Error?cause.message:'模型设置失败');}
  finally{if(version===generation.current)setBusy(false);}
 }
 async function recover(operationId?:string){
  if(busy||!modelApi.inspectRecovery)return;
  if(operationId&&(!modelApi.acknowledgeRecovery||confirming!==operationId||!recovery?.find(item=>item.operationId===operationId)?.allowedRecovery.acknowledgeUnknown))return;
  const version=generation.current;setBusy(true);setError('');
  try{
   if(operationId){await modelApi.acknowledgeRecovery!(operationId);if(version!==generation.current)return;setConfirming(null);await onRecovered?.();if(version!==generation.current)return;const updated=await modelApi.load();if(version!==generation.current)return;setView(updated);}
   const inspected=await modelApi.inspectRecovery();if(version!==generation.current)return;setRecovery(inspected);
  }catch(cause){if(version===generation.current)setError(cause instanceof Error?cause.message:'未决操作核对失败');}
  finally{if(version===generation.current)setBusy(false);}
 }
 const current=view?.current,model=view?.models.find(m=>m.provider===current?.provider&&m.modelId===current.modelId),levels=model?.thinkingLevels??[];
 const disabled=busy||!view?.canSwitch;
 return <section className="space-y-2 border-t border-slate-100 pt-4 text-xs text-slate-600">
  <h3 className="text-sm font-semibold text-slate-700">会话模型</h3>
  <p className="break-all text-slate-500">当前：{current?`${current.provider} / ${current.modelId}`:'尚未选择'}</p>
  {current&&!current.available&&<p className="text-amber-800">当前型号不可用，请选择可用模型并点击应用，继续原会话。</p>}
  <div className="flex min-w-0 items-end gap-2">
   <label className="min-w-0 flex-1">模型<select aria-label="会话模型" className="mt-1 block h-8 w-full min-w-0 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs font-normal text-slate-600" value={choice} disabled={disabled} onChange={event=>setChoice(event.target.value)}>
    <option value="">请选择模型</option>{view?.models.map(model=><option key={JSON.stringify([model.provider,model.modelId])} value={JSON.stringify([model.provider,model.modelId])} disabled={!model.available}>{model.provider} / {model.name}{!model.available?'（不可用）':''}</option>)}
   </select></label>
   <Button aria-label="应用模型"  disabled={disabled||!choice||!leaseId} onClick={()=>void apply('model')}>{busy?'正在应用…':'应用'}</Button>
  </div>
  <div className="flex min-w-0 items-end gap-2">
  <label className="min-w-0 flex-1">思考等级<select aria-label="思考等级" className="mt-1 block h-8 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs font-normal text-slate-600" value={thinking} disabled={disabled||!current?.available||!levels.length} onChange={event=>setThinking(event.target.value as SessionThinkingLevel|'')}>
   <option value="">沿用 Pi 当前或默认等级</option>{levels.map(level=><option key={level} value={level}>{thinkingLabels[level]} · {level}</option>)}
  </select></label>
  <Button aria-label="应用思考等级"  disabled={disabled||!thinking||!current?.available||!levels.includes(thinking)||!leaseId} onClick={()=>void apply('thinking')}>{busy?'正在应用…':'应用'}</Button>
  </div>
  <p className="text-slate-500">当前思考等级：{view?.thinkingLevel?`${thinkingLabels[view.thinkingLevel]} · ${view.thinkingLevel}`:'尚未设置'}{model?.reasoning===false?' · 所选模型不支持思考，仅支持关闭':''}</p>
  {view?.unavailableReason&&<p className="text-amber-800">{view.unavailableReason==='SESSION_BUSY'?'会话运行中，暂不能切换模型或思考等级':view.unavailableReason==='REQUEST_UNKNOWN'?'存在未决操作，需先核对后才能切换模型；这不表示必须继续使用当前模型。':view.unavailableReason}</p>}
  {view?.unavailableReason==='REQUEST_UNKNOWN'&&modelApi.inspectRecovery&&<div className="space-y-2">
   <Button disabled={busy} onClick={()=>void recover()}>{busy?'正在核对…':'核对未决操作'}</Button>
   {recovery?.map(item=><div key={item.operationId} className="space-y-2 border-l-2 border-amber-200 pl-3">
    <p className="break-all">{item.operation} · {item.status==='unknown'?'结果待核对':item.status==='running'?'运行中':item.status==='failed'?'已失败':item.status==='acknowledged'?'已承认未知':'已完成'} · {item.operationId}</p>
    {confirming===item.operationId?<><p className="text-amber-800">请先查看会话树中的错误和工具记录。确认表示接受此操作可能已经发生副作用；只解除此操作的限制，不判定成功或失败，不撤销工具操作，也不会重发旧消息。</p><div className="flex gap-2"><Button disabled={busy||!item.allowedRecovery.acknowledgeUnknown} onClick={()=>void recover(item.operationId)}>确认承认未知并解除限制</Button><Button disabled={busy} onClick={()=>setConfirming(null)}>取消</Button></div></>:<Button disabled={busy||!item.allowedRecovery.acknowledgeUnknown||!modelApi.acknowledgeRecovery} onClick={()=>setConfirming(item.operationId)}>承认结果未知…</Button>}
   </div>)}
   {recovery?.length===0&&<p>未发现可核对操作，请刷新模型设置；若仍受限，请检查原生历史或操作记录是否完整。</p>}
  </div>}
  {view&&<p className="text-slate-500">配置来源：models {view.sources.models} · settings {view.sources.settings}</p>}
  {model&&<p className="text-slate-500">上下文容量 {model.contextWindow?.toLocaleString()??'未知'} · 最大输出 {model.maxTokens?.toLocaleString()??'未知'}</p>}
  <ErrorToast message={error} onDismiss={()=>setError('')}/>
 </section>;
}
