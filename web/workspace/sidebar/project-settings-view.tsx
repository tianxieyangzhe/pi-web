import {useEffect,useRef,useState} from 'react';
import {FolderPlus,Trash2} from 'lucide-react';
import type {Project} from '../../domain/models';
import {DirectoryPicker} from '../directory-picker';
import {SettingsActions,SettingsPage,settingsInput} from '../settings-page';
export function ProjectSettingsView({project,onClose,onSave,onDelete}:{project:Project|null;onClose:()=>void;onSave:(body:Record<string,unknown>)=>Promise<void>;onDelete?:(id:string)=>Promise<void>}) {
 const [name,setName]=useState(project?.name??''),[description,setDescription]=useState(project?.description??''),[rootPath,setRootPath]=useState(project?.rootPath??''),[status,setStatus]=useState(project?.status??'active'),[picker,setPicker]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const unchanged=!!project&&name===project.name&&description===(project.description??'')&&rootPath===project.rootPath&&status===project.status;
 const pending=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 async function save(){
  if(pending.current||unchanged||!name.trim()||!rootPath.trim())return;
  const body:Record<string,unknown>=project?{}:{name,description,rootPath,kind:'code'};
  if(project){for(const [key,value,original] of [['name',name,project.name],['description',description,project.description??''],['rootPath',rootPath,project.rootPath],['status',status,project.status]])if(value!==original)body[key]=value;if(!Object.keys(body).length){onClose();return;}}
  pending.current=true;setBusy(true);setError('');
  try{await onSave(body);}catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:'无法保存项目');}finally{pending.current=false;if(mounted.current)setBusy(false);}
 }
 async function remove(){if(!project||!onDelete||pending.current||!window.confirm(`删除项目“${project.name}”？仍被会话或其他记录引用时无法删除。磁盘文件会保留。`))return;pending.current=true;setBusy(true);setError('');try{await onDelete(project.id);}catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:'无法删除项目');}finally{pending.current=false;if(mounted.current)setBusy(false);}}
 return <SettingsPage kind="Project" title={project?'项目设置':'新建项目'} busy={busy} onClose={onClose}><form onSubmit={event=>{event.preventDefault();void save();}}><fieldset disabled={busy} className="m-0 min-w-0 space-y-6 border-0 p-0">
  <label className="block text-sm text-slate-700">项目名称<input className={settingsInput} value={name} maxLength={120} onChange={event=>setName(event.target.value)}/></label>
  <label className="block text-sm text-slate-700">说明<textarea className={settingsInput} value={description} maxLength={2000} rows={3} onChange={event=>setDescription(event.target.value)}/></label>
  <div><label className="block text-sm text-slate-700">目录绝对路径<input className={`${settingsInput} font-mono`} value={rootPath} placeholder="/path/to/project" onChange={event=>setRootPath(event.target.value)}/></label><button type="button" className="mt-2 flex items-center gap-1 rounded-md px-3 py-2 text-sm text-emerald-800 hover:bg-emerald-50" onClick={()=>setPicker(true)}><FolderPlus size={16}/>选择项目目录</button></div>
  {project&&<label className="block text-sm text-slate-700">状态<select className={settingsInput} value={status} onChange={event=>setStatus(event.target.value as typeof status)}><option value="active">进行中</option><option value="disabled">已停用</option><option value="archived">已归档</option></select></label>}
 </fieldset>{error&&<p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}<SettingsActions busy={busy} disabled={!name.trim()||!rootPath.trim()||unchanged} label="保存项目" onClose={onClose}>{project&&onDelete&&<button type="button" disabled={busy} onClick={()=>void remove()} className="mr-auto flex items-center gap-1 rounded-md px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-40"><Trash2 size={14}/>删除项目</button>}</SettingsActions></form>{picker&&<DirectoryPicker onClose={()=>setPicker(false)} onSelect={path=>{setRootPath(path);setPicker(false);}}/>}</SettingsPage>;
}
