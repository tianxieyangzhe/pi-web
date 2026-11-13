import { ErrorToast } from './conversation/error-toast';
import {Button} from '../components/button';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ChevronDown,FileText,LoaderCircle} from 'lucide-react';
import {settingsSelect,settingsTextarea,settingsLabel,settingsInlineLabel,settingsSelectIcon} from './settings-page';
import {api} from '../api/client';
import {randomUUID} from '../api/random-uuid';
import {activeGeneration,type ProjectRulesStatus,type ProjectRuleGeneration} from '../../src/application/ports/project-rule-generations';
function statusText(task:ProjectRuleGeneration){
 const action=task.mode==='revise'?'润色':'生成';
 switch(task.status){
  case 'queued':return '等待开始';
  case 'running':return task.progress?.phase==='reading'?`正在读取项目文件 · ${task.progress.tool??'read'}`:`正在分析项目并${action}规则`;
  case 'publishing':return '正在保存新版本';
  case 'cancelling':return '正在取消生成';
  case 'succeeded':return `${action}完成 · v${task.resultRevision}`;
  case 'cancelled':return '已取消，原版本保留';
  case 'failed':return `${action}失败，原版本保留`;
  case 'interrupted':return '任务已中断，请重新生成';
 }
}
export function ProjectRulesSettings({projectId,workspaceId,name,children,previewPosition='right'}:{projectId:string;workspaceId?:string;name?:string;children?:ReactNode;previewPosition?:'left'|'right'}){
 const url=workspaceId?`/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/agent-rules`:`/api/projects/${encodeURIComponent(projectId)}/agent-rules`;
 const [value,setValue]=useState<ProjectRulesStatus|null>(null),[skills,setSkills]=useState<Array<{id:string;name:string}>>([]),[skill,setSkill]=useState(''),[requirements,setRequirements]=useState('');
 const [pending,setPending]=useState(false),[error,setError]=useState(''),[readError,setReadError]=useState(''),[skillError,setSkillError]=useState(''),[refresh,setRefresh]=useState(0);
 const alive=useRef(true),lock=useRef(false),restored=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{const controller=new AbortController();void api.generationSkills(controller.signal).then(result=>{if(!controller.signal.aborted)setSkills(result.skills);}).catch(e=>{if(!controller.signal.aborted)setSkillError(e instanceof Error?e.message:'技能列表读取失败');});return()=>controller.abort();},[]);
 useEffect(()=>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,hasActiveTask=true;
  async function read(){try{
   const next=await api.projectRules(url,controller.signal);if(controller.signal.aborted)return;setValue(next);setReadError('');hasActiveTask=!!next.generation&&activeGeneration(next.generation.status);
   if(!restored.current){restored.current=true;if(next.generation){setSkill(next.generation.skillId??'');setRequirements(next.generation.mode==='revise'?next.generation.requirements:'');}}
  }catch(e){if(!controller.signal.aborted)setReadError(e instanceof Error?e.message:'规则状态读取失败');}
   if(!controller.signal.aborted&&hasActiveTask)timer=setTimeout(()=>void read(),1500);
  }
  void read();return()=>{controller.abort();if(timer)clearTimeout(timer);};
 },[url,refresh]);
 const task=value?.generation,working=!!task&&activeGeneration(task.status);
 async function mutate(work:()=>Promise<ProjectRulesStatus>){if(lock.current)return;lock.current=true;setPending(true);setError('');try{const next=await work();if(alive.current)setValue(next);}catch(e){if(alive.current)setError(e instanceof Error?e.message:'操作失败');}finally{lock.current=false;if(alive.current){setPending(false);setRefresh(n=>n+1);}}}
 return <section className="@container min-w-0" aria-label={`${name??''}项目规则`}>
  <div className="grid min-w-0 grid-cols-1 gap-6 @3xl:grid-cols-2 @3xl:gap-8">
   <div className={`min-w-0 space-y-6 ${previewPosition==='left'?'order-2':''}`}>
    {children}
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
     <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="m-0 text-sm font-semibold text-slate-800">{name?`${name} · `:''}项目规则</h2><label className="flex items-center gap-2 text-xs text-slate-600"><input className="size-4 accent-emerald-700" type="checkbox" checked={value?.enabled??false} disabled={pending||working||!value?.revision} onChange={e=>{const enabled=e.target.checked;void mutate(()=>api.setProjectRules(url,enabled,value!.writeETag));}}/>启用 AGENTS.md</label></div>
     <div className="space-y-2">
      <div className="flex min-w-0 items-center gap-3"><label className="flex min-w-0 flex-1 items-center gap-3"><span className={settingsInlineLabel}>生成技能</span><span className="relative min-w-0 flex-1"><select aria-label="生成技能" value={skill} disabled={pending||working} onChange={e=>setSkill(e.target.value)} className={settingsSelect}><option value="">不使用技能 · 模型直接生成</option>{skills.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}{skill&&!skills.some(s=>s.id===skill)&&<option value={skill}>{skill}</option>}</select><ChevronDown size={15} aria-hidden="true" className={settingsSelectIcon}/></span></label><Button variant="primary" type="button" disabled={pending||working||!value} onClick={()=>void mutate(()=>api.generateProjectRules(url,{mode:'generate',skillId:skill||null},value!.writeETag,randomUUID()))}>生成 AGENTS.md</Button></div>
      <div role="status" className="flex min-w-0 items-start gap-3 py-1 text-xs leading-5"><span className="w-16 shrink-0 text-slate-500">生成状态</span><div className={`min-w-0 flex-1 ${task?.status==='failed'||task?.status==='interrupted'?'text-amber-700':'text-slate-500'}`}><span className="flex items-center gap-2">{working&&<LoaderCircle size={13} className="shrink-0 animate-spin"/>}{task?statusText(task):value?'暂无生成任务':readError?'状态读取失败':'正在读取状态…'}</span>{task?.error&&<p className="mt-1 mb-0 [overflow-wrap:anywhere]">{task.error.message}</p>}</div></div>
     </div>
     {skillError&&<p className="text-xs text-amber-700">{skillError}，仍可不使用技能生成。</p>}
     <div className="space-y-2"><div className="flex items-center justify-between gap-3"><label htmlFor={`rule-requirements-${projectId}`} className={settingsLabel}>补充要求</label><Button variant="primary" type="button" disabled={pending||working||!value?.revision||!requirements.trim()} title={!value?.revision?'请先生成 AGENTS.md':!requirements.trim()?'请输入润色意见':undefined} onClick={()=>void mutate(()=>api.generateProjectRules(url,{mode:'revise',requirements,skillId:null},value!.writeETag,randomUUID()))}>润色</Button></div><textarea id={`rule-requirements-${projectId}`} aria-label="项目规则润色要求" rows={4} maxLength={4000} value={requirements} disabled={pending||working} onChange={e=>setRequirements(e.target.value)} placeholder={value?.revision?'说明希望如何修改已有 AGENTS.md':'请先生成 AGENTS.md，再填写修改意见进行润色'} className={settingsTextarea}/></div>
     {working&&<div className="flex items-center gap-2"><Button type="button" disabled={pending||task?.status==='cancelling'||task?.status==='publishing'} onClick={()=>void mutate(()=>api.cancelProjectRuleGeneration(url,task!.id))}>取消任务</Button></div>}
     <p className="m-0 text-xs leading-5 text-slate-500">生成与润色在后台进行，切换页面不影响进度。完成后更新{previewPosition==='left'?'左':'右'}侧预览。</p>
     <ErrorToast message={error||readError} onRetry={()=>setRefresh(n=>n+1)}/>
    </section>
   </div>
   <aside className={`flex min-h-96 min-w-0 flex-col self-start overflow-hidden rounded-xl border border-slate-200 bg-slate-50 @3xl:sticky @3xl:top-0 @3xl:max-h-[calc(100dvh-12rem)] ${previewPosition==='left'?'order-1':''}`} aria-label="AGENTS.md预览">
    <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-5 py-4 text-sm font-semibold text-slate-700"><FileText size={16} className="text-slate-400"/>AGENTS.md <span className="ml-auto text-xs font-normal text-slate-500">{value?.revision?`v${value.revision} · 只读`:'只读预览'}</span></header>
    <pre className="m-0 min-h-64 flex-1 overflow-auto whitespace-pre-wrap p-5 font-mono text-xs leading-6 text-slate-700 [overflow-wrap:anywhere]">{value?.markdown||(working?'正在生成，完成后将在这里显示项目规则。':`尚未生成项目规则。可在${previewPosition==='left'?'右':'左'}侧选择技能或直接交给模型生成。`)}</pre>
    <p className="m-0 shrink-0 border-t border-slate-200 px-5 py-3 text-xs leading-5 text-slate-500">{working&&value?.revision?'当前仍显示已保存版本；生成成功后替换。':'启用后，作用于此项目的助手会加载这些规则。'}</p>
   </aside>
  </div>
 </section>;
}
