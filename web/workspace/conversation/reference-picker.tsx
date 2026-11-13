import {Button} from '../../components/button';
import { Bot, BookOpen, Folder, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { FileEntry, Project } from "../../domain/models";
import type { ProjectMessageReference } from "../../../src/domain/message-references";
import { validateAttachments } from "./clipboard";
import { ErrorToast } from "./error-toast";
type DirectoryReference = ProjectMessageReference;
function sameReference(left: DirectoryReference, right: DirectoryReference) {
  return left.path === right.path && left.projectId === right.projectId;
}

export function ReferencePicker({ selected, onChange, disabled, projectCount = 0 }: { selected: File[]; onChange: (files: File[]) => void; disabled?: boolean; projectCount?: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  function add(files: FileList | null) {
    if (!files?.length) return;
    const next = [...selected, ...Array.from(files)];
    try { validateAttachments(next, projectCount); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "文件不可用"); return; }
    setError(""); onChange(next);
  }
  return <div className="reference-picker">
    <input ref={input} type="file" multiple hidden disabled={disabled} onChange={event => { add(event.target.files); event.target.value = ""; }} />
    <Button variant="ghost" type="button" className="reference-picker__trigger" title="点击上传或将文件拖入输入框；文件保存后供模型按需读取，图片直接识别" disabled={disabled} onClick={() => input.current?.click()}><Paperclip size={15}/> 上传文件</Button>
    <ErrorToast message={error} onDismiss={() => setError("")} />
  </div>;
}

export function ProjectReferencePicker({ projects, selected, onChange, disabled, uploadCount, onDone, listFiles }: { projects: Project[]; selected: DirectoryReference[]; onChange: (references: DirectoryReference[]) => void; disabled?: boolean; uploadCount: number; onDone?: () => void; listFiles?:(projectId:string,path:string)=>Promise<import('../../domain/models').ProjectFileListing> }) {
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [open]);
  useEffect(() => {
    if (!open || !projectId) return;
    let live = true;
    setEntries([]); setError(""); setTruncated(false);
    const listing = (listFiles??api.listFiles)(projectId.slice(8), path);
    listing.then(result => { if (live) { setEntries(result.entries); setTruncated(result.truncated); } }).catch(cause => { if (live) setError(cause instanceof Error ? cause.message : "无法读取目录"); });
    return () => { live = false; };
  }, [open, projectId, path, listFiles]);
  function toggle(item: DirectoryReference) {
    const exists = selected.some(value => sameReference(value, item));
    if (!exists && selected.length + uploadCount >= 10) { setError("最多选择 10 个参考文件"); return; }
    setError(""); onChange(exists ? selected.filter(value => !sameReference(value, item)) : [...selected, item]);
  }
  return <div className="reference-picker">
    <Button variant="ghost" type="button" className="reference-picker__trigger" title="将选中文件正文保存为当前会话上下文，手动删除前持续生效" disabled={disabled || !projects.length} onClick={() => { setProjectId(projects[0] ? `project:${projects[0].id}` : ""); setPath(""); setError(""); setOpen(true); }}><Folder size={15}/> 参考项目文件</Button>
    {open && <dialog ref={dialog} className="reference-picker__dialog" aria-label="参考项目文件" onClose={() => { setOpen(false); onDone?.(); }}>
      <header><b>参考项目文件</b><Button variant="ghost" size="icon" type="button" aria-label="关闭" onClick={() => dialog.current?.close()}><X size={16}/></Button></header>
      <div className="reference-picker__projects">{projects.map(project => <Button type="button" key={project.id} aria-pressed={projectId === `project:${project.id}`} onClick={() => { setProjectId(`project:${project.id}`); setPath(""); }}>{project.name}</Button>)}</div>
      <div className="reference-picker__path"><span>{path || "项目根目录"}</span>{path && <Button type="button" onClick={() => setPath(path.split(/[\\/]/).slice(0,-1).join("/"))}>上一级</Button>}</div>
      <div className="reference-picker__entries">{entries.map(entry => { const reference: DirectoryReference = {projectId:projectId.slice(8),path:entry.path}; return entry.type === "directory" ? <Button variant="ghost" size="row" type="button" key={entry.path} onClick={() => setPath(entry.path)}><Folder size={14}/> {entry.name} /</Button> : <label key={entry.path}><input type="checkbox" disabled={disabled} checked={selected.some(item => sameReference(item, reference))} onChange={() => toggle(reference)}/>{entry.name}</label>; })}{truncated && <p>仅显示前 1000 项</p>}</div>
      <ErrorToast message={error} onDismiss={()=>setError('')}/>
      <footer><span>已选 {selected.length} 个项目文件</span><Button variant="primary" type="button" onClick={() => dialog.current?.close()}>完成</Button></footer>
    </dialog>}
  </div>;
}

export function ResourceReferencePicker({kind,disabled,onSelect,onSelectAssistant,assistantName,projectId,workspaceId}:{kind:'assistant'|'skill';assistantName?:string;disabled:boolean;onSelect:(files:File[])=>void;onSelectAssistant?:(id:string,signal:AbortSignal)=>Promise<void>;projectId?:string;workspaceId?:string}) {
  const [open,setOpen]=useState(false),[items,setItems]=useState<Array<{id:string;name:string;detail:string}>>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false),[choosing,setChoosing]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null),abort=useRef<AbortController|null>(null);
  const title=kind==='assistant'?'引用助手':'引用 Skill';
  useEffect(()=>{if(!open)return;const controller=new AbortController();abort.current=controller;dialog.current?.showModal();setLoading(true);setError('');setItems([]);
    const work=kind==='assistant'?api.listReferenceAgents({...(projectId?{projectId}:{}),...(workspaceId?{workspaceId}:{})},controller.signal).then(agents=>agents.map(a=>({id:a.id,name:a.name,detail:`${a.definition?.source?.kind==='workspace'?'工作区助手':a.definition?.source?.kind==='project'?'项目助手':'通用型助手'} · v${a.revision}`}))):api.generationSkills(controller.signal).then(result=>result.skills.map(s=>({id:s.id,name:s.name,detail:s.description})));
    void work.then(result=>{if(!controller.signal.aborted)setItems(result);}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'加载失败');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[open,kind,projectId,workspaceId]);
  useEffect(()=>{if(disabled&&open&&!choosing){abort.current?.abort();setOpen(false);}},[disabled,open,choosing]);
  const filename=(text:string)=>text.replace(/[\\/\u0000-\u001f\u007f]/g,'_').slice(0,150)||'reference';
  async function choose(id:string){
    if(choosing||disabled)return;const controller=abort.current;if(!controller||controller.signal.aborted)return;setChoosing(true);setError('');
    try{
      const files:File[]=[];
      if(kind==='skill'){const skill=await api.getSkill(id,controller.signal);files.push(new File([skill.content],`skill-${filename(skill.id)}.md`,{type:'text/markdown'}));}
      else {
        if(!onSelectAssistant)throw new Error('请先打开可用会话');
        await onSelectAssistant(id,controller.signal);
        if(!controller.signal.aborted)setOpen(false);
        return;
      }
      if(controller.signal.aborted)return;if(!files.length)throw new Error('没有可引用的正文');onSelect(files);setOpen(false);
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'引用失败');}
    finally{setChoosing(false);}
  }
  return <div className="reference-picker">
    <Button variant="ghost" type="button" className="reference-picker__trigger" title={kind==='assistant'&&assistantName?assistantName:undefined} disabled={disabled} onClick={()=>{setChoosing(false);setOpen(true);}}>{kind==='assistant'?<Bot size={15}/>:<BookOpen size={15}/>} <span className="max-w-40 truncate">{kind==='assistant'&&assistantName?assistantName:title}</span></Button>
    {open&&<dialog ref={dialog} className="reference-picker__dialog" aria-label={title} onClose={()=>setOpen(false)}>
      <header><b>{title}</b><Button variant="ghost" size="icon" type="button" aria-label="关闭" onClick={()=>dialog.current?.close()}><X size={16}/></Button></header>
      <div className="reference-picker__entries">{loading?<p>正在加载…</p>:items.length?items.map(item=><Button variant="ghost" size="row" type="button" key={item.id} disabled={choosing||disabled} title={item.detail} onClick={()=>void choose(item.id)}>{item.name} · {item.detail}</Button>):<p>暂无可引用的{kind==='assistant'?'助手':'Skill'}</p>}</div>
      <ErrorToast message={error} onRetry={()=>setOpen(false)} onDismiss={()=>setError('')}/>
      <footer>{kind==='assistant'?(choosing?'正在应用助手…':'选择后用于当前会话的系统提示词，再次点击可更换助手。'):(choosing?'正在读取正文…':'选择后作为本次消息的文件引用，可在输入框中移除。')}</footer>
    </dialog>}
  </div>;
}

export function readReference(file: File): Promise<{name: string; data: string}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取上传文件，请重新选择"));
    reader.onabort = () => reject(new Error("读取上传文件已取消"));
    reader.onload = () => {
      if (typeof reader.result !== "string" || !reader.result.includes(",")) { reject(new Error("无法读取上传文件")); return; }
      resolve({name: file.name, data: reader.result.slice(reader.result.indexOf(",") + 1)});
    };
    reader.readAsDataURL(file);
  });
}
