import { useState } from 'react';
import { ArrowRight, FolderKanban, Plus } from 'lucide-react';
import type { Project } from '../../domain/models';
import { AuxiliaryDialog } from '../auxiliary-dialog';
export function ProjectSessionCreateDialog({projects,creatingProjectId,onClose,onSelectProject,onCreateProject}:{projects:Project[];creatingProjectId:string|null;onClose:()=>void;onSelectProject:(id:string,body?:Record<string,unknown>)=>void;onCreateProject:()=>void}) {
  const [purpose,setPurpose]=useState('');
  return <AuxiliaryDialog title="新建项目会话" onClose={onClose}><div className="space-y-4 p-5"><label className="block text-sm">会话说明（可选）<input className="mt-2 block w-full rounded border border-slate-200 p-2" maxLength={500} value={purpose} onChange={event=>setPurpose(event.target.value)} placeholder="新会话" disabled={creatingProjectId!==null}/></label>{projects.length?<div className="project-session-picker" aria-label="选择项目">{projects.map(project=><button className="project-session-picker__option" key={project.id} type="button" disabled={creatingProjectId!==null} onClick={()=>onSelectProject(project.id,{purpose})}><FolderKanban size={16}/><span className="project-session-picker__name">{project.name}</span><span className="project-session-picker__action">{creatingProjectId===project.id?'创建中…':'新建并进入'}<ArrowRight size={14}/></span></button>)}</div>:<div><p>还没有可用项目。</p><button className="primary mt-3" onClick={onCreateProject}><Plus size={14}/>新建项目</button></div>}</div></AuxiliaryDialog>;
}
