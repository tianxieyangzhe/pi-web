import {Button} from '../../components/button';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {ArrowLeft,FileText,LoaderCircle,Upload} from 'lucide-react';
import {api} from '../../api/client';
import type {Agent,Project} from '../../domain/models';
import {isUnifiedAssistant,type UnifiedAssistantDefinition} from '../../../src/domain/assistant-document';
import type {WorkspaceRecord} from '../../../src/domain/workspace';
import {Response} from '../conversation/ai-elements/response';

export type RoleTarget={kind?:'project';resource?:Agent};
const field='flex min-w-0 flex-col gap-2 text-sm font-medium text-slate-700';
const input='w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400';

export function RoleEditor({target,projects,workspaces,onClose,onSaved}:{target:RoleTarget;projects:Project[];workspaces:WorkspaceRecord[];onClose:()=>void;onSaved:(a:Agent)=>void}){
 const initial=target.resource?.definition;
 const [definition,setDefinition]=useState<UnifiedAssistantDefinition>(()=>isUnifiedAssistant(initial)?structuredClone(initial):{format:4,scope:initial?.source?.kind??'global',source:initial?.source?.kind==='workspace'?{...initial.source,projectIds:initial.source.projectIds?.length?initial.source.projectIds:null}:initial?.source??null,systemPromptMode:initial?.systemPrompt?'replace':'inherit',systemPrompt:initial?.systemPrompt??''});
 const [name,setName]=useState(target.resource?.name??''),[feedback,setFeedback]=useState(''),[pending,setPending]=useState<'polish'|'save'|null>(null),[error,setError]=useState('');
 const [messages,setMessages]=useState<Array<{role:string;content:string}>>([]);
 const abort=useRef<AbortController|null>(null),alive=useRef(true),uploadRevision=useRef(0),uploadInput=useRef<HTMLInputElement>(null),thread=useRef<HTMLDivElement>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;abort.current?.abort();};},[]);
 useLayoutEffect(()=>{const node=thread.current;if(node)node.scrollTop=node.scrollHeight;},[messages,pending]);
 const source=definition.source,workspace=source?.kind==='workspace'?workspaces.find(w=>w.id===source.workspaceId):null;
 function useRaw(){const text=feedback;if(pending||!text.trim())return;setError('');setFeedback('');setDefinition(d=>({...d,systemPromptMode:'replace',systemPrompt:text}));setMessages(m=>[...m,{role:'你',content:text},{role:'助手',content:'已直接使用原始内容，可以在右侧预览。'}]);}
 async function polish(){if(pending||!feedback.trim())return;const text=feedback,controller=new AbortController();abort.current=controller;setPending('polish');setError('');setFeedback('');setMessages(m=>[...m,{role:'你',content:text}]);
  try{const mode=definition.systemPrompt?'revise':'generate';const result=await api.prepareAgent({mode,currentDraft:definition,...(mode==='generate'?{inputText:text}:{feedback:text})},controller.signal);if(!alive.current||controller.signal.aborted)return;setDefinition(result.definition as UnifiedAssistantDefinition);setFeedback('');setMessages(m=>[...m,{role:'助手',content:'系统提示词已更新，可以在右侧预览。'}]);}
  catch(cause){if(alive.current)setError(controller.signal.aborted?'已取消，原草稿保留':cause instanceof Error?cause.message:'润色失败');}finally{if(alive.current)setPending(null);}
 }
 async function upload(file?:File){if(!file||pending)return;const revision=++uploadRevision.current;try{if(file.size>262144)throw Error('文件不能超过256KiB');const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());if(!text.trim()||text.includes('\0'))throw Error('请选择非空UTF-8文本');if(!alive.current||revision!==uploadRevision.current)return;setDefinition(d=>({...d,systemPromptMode:'replace',systemPrompt:text}));setError('');}catch(cause){if(alive.current&&revision===uploadRevision.current)setError(cause instanceof Error?cause.message:'读取失败');}}
 async function save(){if(pending)return;setPending('save');setError('');try{const body={name,kind:'project',definition,status:target.resource?.status??'active'};const result=target.resource?await api.updateAgent(target.resource.id,{...body,writeETag:target.resource.writeETag}):await api.createAgent(body);if(alive.current){window.dispatchEvent(new Event('roles-updated'));onSaved(result);}}catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:'保存失败');}finally{if(alive.current)setPending(null);}}
 return <section className="role-editor @container relative col-start-2 row-start-1 flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-l border-slate-200 bg-white text-slate-700" aria-label="助手编辑" aria-busy={!!pending}>
  <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 @3xl:px-7">
   <div><h2 className="m-0 text-lg font-semibold text-slate-900">{target.resource?'编辑助手':'新建助手'}</h2><p className="mt-1 text-xs text-slate-500">设置系统提示词，选择需要关联的项目或工作区。</p></div>
   <Button type="button"  onClick={onClose}><ArrowLeft size={15}/>返回列表</Button>
  </header>
  <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto @3xl:grid-cols-2 @3xl:overflow-hidden">
   <section className="flex min-w-0 flex-col gap-6 p-5 @3xl:min-h-0 @3xl:overflow-y-auto @3xl:border-r @3xl:border-slate-200 @3xl:p-7">
    <div className="grid grid-cols-1 gap-5 @xl:grid-cols-2 @3xl:grid-cols-1 @5xl:grid-cols-2">
     <label className={`${field} col-span-full`}>名称<input className={input} autoComplete="off" value={name} maxLength={120} disabled={!!pending} placeholder="为助手命名" onChange={e=>setName(e.target.value)}/></label>
     <label className={field}>作用范围<select className={input} disabled={!!pending} value={source?.kind==='project'?`p:${source.projectId}`:source?.kind==='workspace'?`w:${source.workspaceId}`:'global'} onChange={e=>{const value=e.target.value;if(value==='global'){setDefinition(d=>({...d,scope:'global',source:null}));return;}const type=value.slice(0,1),id=value.slice(2);setDefinition(d=>({...d,scope:type==='p'?'project':'workspace',source:type==='p'?{kind:'project',projectId:id}:{kind:'workspace',workspaceId:id,projectIds:null}}));}}>
      <option value="global">通用型</option><optgroup label="独立项目">{projects.filter(p=>p.status==='active').map(p=><option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}</optgroup><optgroup label="工作区">{workspaces.map(w=><option key={w.id} value={`w:${w.id}`}>{w.name}</option>)}</optgroup>
     </select><span className="text-xs font-normal leading-5 text-slate-500">{source?'在对应范围内优先显示。':'可在任意项目或工作区中选择。'}</span></label>
     <label className={field}>系统提示词<select className={input} value={definition.systemPromptMode} disabled={!!pending} onChange={e=>setDefinition(d=>({...d,systemPromptMode:e.target.value as 'inherit'|'replace',systemPrompt:e.target.value==='inherit'?'':d.systemPrompt}))}><option value="inherit">继承 Pi 默认提示词</option><option value="replace">使用自定义提示词</option></select></label>
     {workspace&&source?.kind==='workspace'&&<fieldset className="col-span-full m-0 min-w-0 rounded-lg border border-slate-200 p-4"><legend className="px-1 text-sm font-medium">工作区项目</legend>
      <label className="flex items-center gap-2 text-sm"><input className="size-4 accent-emerald-700" type="checkbox" disabled={!!pending} checked={source.projectIds===null} onChange={e=>setDefinition(d=>({...d,source:{...source,projectIds:e.target.checked?null:workspace.projects.slice(0,1).map(p=>p.id)}}))}/>整个工作区</label>
      <div className="mt-3 flex flex-wrap gap-2">{workspace.projects.map(p=><label key={p.id} className="flex min-w-0 items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs has-checked:border-emerald-200 has-checked:bg-emerald-50 has-disabled:opacity-60"><input className="size-3.5 shrink-0 accent-emerald-700" type="checkbox" disabled={!!pending||source.projectIds===null} checked={source.projectIds===null||source.projectIds.includes(p.id)} onChange={e=>setDefinition(d=>({...d,source:{...source,projectIds:e.target.checked?[...(source.projectIds??[]),p.id]:(source.projectIds??[]).filter(id=>id!==p.id)}}))}/><span className="break-all">{p.name}</span></label>)}</div>
     </fieldset>}
    </div>
    <section className="flex h-96 min-h-64 shrink-0 flex-col gap-4 overflow-hidden border-t border-slate-200 pt-5 @3xl:h-auto @3xl:flex-1" aria-label="提示词对话">
     <div className="flex shrink-0 flex-wrap items-center justify-between gap-3"><h3 className="m-0 text-sm font-semibold">对话完善提示词</h3><Button type="button" disabled={!!pending} onClick={()=>uploadInput.current?.click()}><Upload size={14}/>上传替换文件</Button><input ref={uploadInput} className="hidden" type="file" accept=".md,.txt,text/plain,text/markdown" disabled={!!pending} onChange={e=>{void upload(e.target.files?.[0]);e.target.value='';}}/></div>
     <div ref={thread} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-y-contain pr-1" aria-live="polite">{!messages.length&&<p className="m-0 py-2 text-sm leading-6 text-slate-500">无需上传 Markdown，直接输入或粘贴内容即可润色生成助手提示词；生成后还可以继续提出修改意见。</p>}{messages.map((m,i)=><article key={i} className={`max-w-full shrink-0 rounded-lg px-3 py-2 text-sm leading-6 [overflow-wrap:anywhere] ${m.role==='你'?'ml-5 bg-slate-100':'mr-5 bg-emerald-50/60'}`}><b className="mb-1 block text-xs font-medium text-slate-500">{m.role}</b><Response>{m.content}</Response></article>)}{pending==='polish'&&<p role="status" className="flex items-center gap-2 text-xs text-slate-500"><LoaderCircle size={14} className="animate-spin"/>正在润色…<Button type="button" className="ml-auto" onClick={()=>abort.current?.abort()}>取消</Button></p>}</div>
     <div className="shrink-0 rounded-xl border border-slate-300 bg-white p-3 focus-within:border-emerald-600 focus-within:ring-1 focus-within:ring-emerald-600"><textarea aria-label="提示词要求或修改意见" className="block max-h-40 min-h-20 w-full resize-y overflow-y-auto border-0 bg-transparent p-0 text-sm! leading-6 outline-none placeholder:text-slate-400" rows={3} disabled={!!pending} value={feedback} maxLength={definition.systemPrompt?4000:262144} placeholder="直接输入或粘贴内容，润色为助手提示词…" onChange={e=>setFeedback(e.target.value)} onKeyDown={e=>{if(!e.nativeEvent.isComposing&&e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();void polish();}}}/><div className="mt-3 flex items-center justify-between gap-2"><span className="text-[11px] text-slate-400">Ctrl / ⌘ + Enter 润色</span><div className="flex shrink-0 gap-2"><Button type="button" disabled={!!pending||!feedback.trim()} onClick={useRaw}>使用原始内容</Button><Button variant="primary" type="button" disabled={!!pending||!feedback.trim()} onClick={()=>void polish()}>润色提示词</Button></div></div></div>
    </section>
    {error&&<p role="alert" className="m-0 max-h-40 shrink-0 overflow-y-auto whitespace-pre-wrap rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 [overflow-wrap:anywhere]">{error}</p>}
   </section>
   <aside className="flex min-h-80 min-w-0 flex-col border-t border-slate-200 bg-slate-50 @3xl:min-h-0 @3xl:border-t-0" aria-label="系统提示词预览">
    <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-5 py-5 text-sm font-semibold @3xl:px-7"><FileText size={16} className="text-slate-400"/>系统提示词预览<span className="ml-auto rounded bg-white px-2 py-1 text-[11px] font-normal text-slate-500">只读</span></header>
    <pre className="m-0 min-h-64 flex-1 overflow-auto whitespace-pre-wrap p-5 font-mono text-xs leading-6 text-slate-700 [overflow-wrap:anywhere] @3xl:min-h-0 @3xl:p-7">{definition.systemPromptMode==='inherit'?'继承 Pi 默认系统提示词':definition.systemPrompt||'上传提示词文件，或在左侧描述你的要求。'}</pre>
    <p className="m-0 shrink-0 border-t border-slate-200 px-5 py-4 text-xs leading-5 text-slate-500 @3xl:px-7">项目 AGENTS.md 在项目设置中生成和启用。</p>
   </aside>
  </div>
  <footer className="flex shrink-0 justify-end gap-3 border-t border-slate-200 bg-white px-5 py-4 @3xl:px-7"><Button type="button"  onClick={onClose}>取消</Button><Button variant="primary" type="button"  disabled={!!pending||!name.trim()||source?.kind==='project'&&!source.projectId||source?.kind==='workspace'&&source.projectIds?.length===0||definition.systemPromptMode==='replace'&&!definition.systemPrompt.trim()} onClick={()=>void save()}>{pending==='save'?<><LoaderCircle size={14} className="animate-spin"/>保存中…</>:'保存助手'}</Button></footer>
 </section>;
}
