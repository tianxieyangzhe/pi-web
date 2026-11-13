import { ErrorToast } from '../conversation/error-toast';
import {Button} from '../../components/button';
import { useMemo, useState } from 'react';
import { api } from '../../api/client';
import type { Project } from '../../domain/models';
import { NativeContextSection } from './native-context-section';
import {SessionModelSettings} from './session-model-settings';
import type { useProjectSession } from '../conversation/project-session/use-project-session';
export function ProjectSessionInspector({project,session}:{project:Project;session:ReturnType<typeof useProjectSession>}) {
  const active=session.sessions.find(item=>item.id===session.sessionId),id=session.sessionId;
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[format,setFormat]=useState<'html'|'jsonl'>('html'),[range,setRange]=useState<'tree'|'branch'>('tree');
  const modelApi=useMemo(()=>({load:()=>api.sessionModels(project.id,id!,session.leaseId??undefined),apply:(provider:string,modelId:string,thinkingLevel?:import('../../../src/domain/session-tools').SessionThinkingLevel)=>api.switchSessionModel(project.id,id!,provider,modelId,session.leaseId!,thinkingLevel),inspectRecovery:async()=>{const current=(await api.listSessions(project.id)).find(item=>item.id===id);if(!current)throw new Error('会话不存在');return Promise.all((current.pendingOperations??[]).filter(item=>item.status==='unknown').map(item=>api.recoverSession(project.id,id!,item.operationId,'inspect')));},acknowledgeRecovery:(operationId:string)=>api.recoverSession(project.id,id!,operationId,'acknowledge-unknown')}),[project.id,id,session.leaseId,session.running]);
  const contextApi=useMemo(()=>({inspect:()=>api.getNativeContext(project.id,id!),compact:()=>api.compactNativeContext(project.id,id!,session.leaseId??undefined),cancel:()=>api.cancelNativeCompaction(project.id,id!)}),[project.id,id,session.leaseId]);
  async function perform(work:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await work();}catch(cause){setError(cause instanceof Error?cause.message:'操作失败');}finally{setBusy(false);}}
  if(!id||!active)return <p className="p-5 text-sm text-slate-500">请先选择会话。</p>;
  return <>
    <section><h3 className="mb-2 font-semibold">Session</h3><p>{active.purpose.trim()||'新会话'}</p><p className="mt-1 break-all text-xs text-slate-500">{active.id} · {session.connection==='open'?'打开':'关闭'}</p></section>
    <SessionModelSettings modelApi={modelApi} leaseId={session.leaseId} onRecovered={async()=>{await session.refresh();await session.reload();}} onApplied={async()=>{await session.modelApplied();await session.reload();}}/>
    <NativeContextSection eventRevision={session.eventRevision} projectId={project.id} sessionId={id} onBusy={session.setCompacting} onRestore={session.restore} running={session.running} contextApi={contextApi}/>
    <section className="flex items-center gap-2 overflow-x-auto border-t border-slate-100 pt-4"><h3 className="m-0 shrink-0 whitespace-nowrap font-semibold">导出会话</h3><div className="flex shrink-0 items-center gap-2"><select aria-label="导出格式" className="rounded border border-slate-200 p-2" value={format} onChange={event=>setFormat(event.target.value as 'html'|'jsonl')}><option value="html">HTML</option><option value="jsonl">JSONL</option></select><select aria-label="导出范围" className="rounded border border-slate-200 p-2" value={range} onChange={event=>setRange(event.target.value as 'tree'|'branch')}><option value="tree">完整树（全部分支）</option><option value="branch">当前分支</option></select><Button  disabled={busy||!active.allowedActions?.export.allowed} onClick={()=>void perform(()=>api.exportSession(project.id,id,format,range))}>下载</Button></div></section>
    <ErrorToast message={error} onDismiss={()=>setError('')}/>
  </>;
}
