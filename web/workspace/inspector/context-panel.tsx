import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { Agent, FilePreview, Mcp, Project, Session } from '../../domain/models';
import type { useProjectSession } from '../conversation/project-session/use-project-session';
import { FileBrowser, FilePreviewPane } from '../files/file-browser';
import { AgentMcpForm } from './agent-mcp-form';
import { ProjectSessionInspector } from './project-session-inspector';
import { AuxiliaryDialog } from '../auxiliary-dialog';
import { SessionInspection } from './session-inspection';
type ResourceKind='project'|'agent'|'mcp';
export function ContextPanel({visible,panelView,selectedProject,session,resourceKind,resourceId,selectedResource,onClose,onOpenFile,onSaveResource,onDeleteResource,onFork,selected,onSelect,onLocate,initialPreview,previewLine}:{visible:boolean;panelView:'files'|'check';selectedProject:Project|null;session:ReturnType<typeof useProjectSession>;resourceKind:ResourceKind|null;resourceId:string|null;selectedResource:Agent|Mcp|null;projects:Project[];agents:Agent[];mcps:Mcp[];onClose:()=>void;onOpenFile:(preview:FilePreview)=>void;onOpenResource:(kind:ResourceKind,id?:string)=>void;onSaveResource:(kind:'agent'|'mcp',id:string|null,body:Record<string,unknown>)=>void;onDeleteResource:(kind:'agent'|'mcp',id:string)=>void;onFork:(session:Session)=>void;selected:string|null;onSelect:(id:string)=>void;onLocate:(id:string)=>void;initialPreview?:FilePreview|null;previewLine?:number}) {
  const [preview,setPreview]=useState<FilePreview|null>(initialPreview??null);
  useEffect(()=>{setPreview(initialPreview??null);},[initialPreview]);
  if(!visible||!selectedProject)return null;
  const files=panelView==='files',title=resourceKind==='mcp'?'MCP':files?'文件':'会话检查';
  return <AuxiliaryDialog title={title} onClose={onClose}>{resourceKind==='mcp'?<AgentMcpForm resource={selectedResource} onSave={body=>onSaveResource('mcp',resourceId,body)} onDelete={resourceId?()=>onDeleteResource('mcp',resourceId):undefined}/>:files?<div className="flex h-[70vh] min-h-0 min-w-0"><div className={preview?'hidden w-1/3 min-w-52 border-r border-slate-200 md:block':'w-full'}><FileBrowser projectId={selectedProject.id} projectName={selectedProject.name} rootPath={selectedProject.rootPath} onOpenFile={value=>setPreview(value)}/></div>{preview&&<div className="min-w-0 flex-1"><FilePreviewPane loadPdf={signal=>api.readFileBlob(selectedProject.id,preview.path,signal)} onDownload={()=>api.downloadFile(selectedProject.id,preview.path)} projectName={selectedProject.name} rootPath={selectedProject.rootPath} preview={preview} line={initialPreview?.path===preview.path?previewLine:undefined} onClose={()=>setPreview(null)}/></div>}</div>:<SessionInspection tree={session.tree} selected={selected} onSelect={onSelect} onLocate={onLocate} settings={<ProjectSessionInspector project={selectedProject} session={session} selectedEntryId={selected} onFork={onFork}/>}/>}</AuxiliaryDialog>;
}
