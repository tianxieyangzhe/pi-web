import {useEffect,useRef,useState} from 'react';
import type {SessionModelView,SessionThinkingLevel} from '../../../src/domain/session-tools';
const thinkingLabels:Record<SessionThinkingLevel,string>={off:'关闭',minimal:'最低',low:'低',medium:'中',high:'高',xhigh:'更高',max:'最高'};
export function SessionModelSettings({modelApi,leaseId,onApplied}:{modelApi:{load:()=>Promise<SessionModelView>;apply:(provider:string,modelId:string,thinkingLevel?:SessionThinkingLevel)=>Promise<SessionModelView>};leaseId:string|null;onApplied:()=>Promise<void>}){
 const [view,setView]=useState<SessionModelView|null>(null),[choice,setChoice]=useState(''),[thinking,setThinking]=useState<SessionThinkingLevel|''>(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const generation=useRef(0);
 useEffect(()=>{
  const version=++generation.current;setView(null);setChoice('');setThinking('');setError('');setBusy(false);
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
   <button aria-label="应用模型" className="h-8 shrink-0 whitespace-nowrap rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40" disabled={disabled||!choice||!leaseId} onClick={()=>void apply('model')}>{busy?'正在应用…':'应用'}</button>
  </div>
  <div className="flex min-w-0 items-end gap-2">
  <label className="min-w-0 flex-1">思考等级<select aria-label="思考等级" className="mt-1 block h-8 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs font-normal text-slate-600" value={thinking} disabled={disabled||!current?.available||!levels.length} onChange={event=>setThinking(event.target.value as SessionThinkingLevel|'')}>
   <option value="">沿用 Pi 当前或默认等级</option>{levels.map(level=><option key={level} value={level}>{thinkingLabels[level]} · {level}</option>)}
  </select></label>
  <button aria-label="应用思考等级" className="h-8 shrink-0 whitespace-nowrap rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40" disabled={disabled||!thinking||!current?.available||!levels.includes(thinking)||!leaseId} onClick={()=>void apply('thinking')}>{busy?'正在应用…':'应用'}</button>
  </div>
  <p className="text-slate-500">当前思考等级：{view?.thinkingLevel?`${thinkingLabels[view.thinkingLevel]} · ${view.thinkingLevel}`:'尚未设置'}{model?.reasoning===false?' · 所选模型不支持思考，仅支持关闭':''}</p>
  {view?.unavailableReason&&<p className="text-amber-800">{view.unavailableReason}</p>}
  {view&&<p className="text-slate-500">配置来源：models {view.sources.models} · settings {view.sources.settings}</p>}
  {model&&<p className="text-slate-500">上下文容量 {model.contextWindow?.toLocaleString()??'未知'} · 最大输出 {model.maxTokens?.toLocaleString()??'未知'}</p>}
  {error&&<p role="alert" className="text-red-700">{error}</p>}
 </section>;
}
