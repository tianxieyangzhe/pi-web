import { ErrorToast } from '../conversation/error-toast';
import {Button} from '../../components/button';
import {useEffect,useRef,useState} from 'react';
import {ProjectRulesSettings} from '../project-rules-settings';
import {ChevronDown,FolderPlus,Trash2} from 'lucide-react';
import type {Project} from '../../domain/models';
import {DirectoryPicker} from '../directory-picker';
import {SettingsActions,SettingsPage,settingsInput,settingsTextarea,settingsSelect,settingsLabel,settingsInlineLabel,settingsSelectIcon} from '../settings-page';
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
 const form=<form onSubmit={event=>{event.preventDefault();void save();}}><fieldset disabled={busy} className="m-0 min-w-0 space-y-6 border-0 p-0">
  <label className={settingsLabel}>项目名称<input className={`${settingsInput} mt-2`} value={name} maxLength={120} onChange={event=>setName(event.target.value)}/></label>
  <label className={settingsLabel}>说明<textarea className={`${settingsTextarea} mt-2`} value={description} maxLength={2000} rows={3} onChange={event=>setDescription(event.target.value)}/></label>
  <div><label htmlFor="project-root-path" className={settingsLabel}>目录绝对路径</label><div className="mt-2 flex min-w-0 items-center gap-2"><input id="project-root-path" className={`${settingsInput} flex-1 font-mono`} value={rootPath} placeholder="/path/to/project" onChange={event=>setRootPath(event.target.value)}/><Button type="button"  onClick={()=>setPicker(true)}><FolderPlus size={16}/>选择项目目录</Button></div></div>
  {project&&<div className="flex min-w-0 items-center gap-3"><label htmlFor="project-status" className={settingsInlineLabel}>状态</label><div className="relative min-w-0 flex-1"><select id="project-status" className={settingsSelect} value={status} onChange={event=>setStatus(event.target.value as typeof status)}><option value="active">进行中</option><option value="disabled">已停用</option><option value="archived">已归档</option></select><ChevronDown size={15} aria-hidden="true" className={settingsSelectIcon}/></div></div>}
 </fieldset><ErrorToast message={error} onDismiss={()=>setError('')}/><SettingsActions busy={busy} disabled={!name.trim()||!rootPath.trim()||unchanged} label="保存项目" onClose={onClose}>{project&&onDelete&&<Button variant="danger" type="button" disabled={busy} onClick={()=>void remove()} className="mr-auto"><Trash2 size={14}/>删除项目</Button>}</SettingsActions></form>;
 return <SettingsPage fullWidth kind="Project" title={project?'项目设置':'新建项目'} busy={busy} onClose={onClose}>{project?<ProjectRulesSettings key={project.id} projectId={project.id}>{form}</ProjectRulesSettings>:form}{picker&&<DirectoryPicker onClose={()=>setPicker(false)} onSelect={path=>{setRootPath(path);setPicker(false);}}/>}</SettingsPage>;
}
