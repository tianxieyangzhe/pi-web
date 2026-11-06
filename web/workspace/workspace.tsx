import { PanelLeftClose, PanelLeftOpen, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RoleDirectory } from './roles/role-directory';
import { RoleEditor, type RoleTarget } from './roles/role-editor';
import type { FilePreview, Project } from '../domain/models';
import type { WorkspaceRecord, WorkspaceSessionDTO } from '../../src/domain/workspace';
import { FilePreviewPane } from './files/file-browser';
import { ProjectSessionCreateDialog } from './sidebar/project-session-create-dialog';
import { ProjectSessionView } from './conversation/project-session/project-session-view';
import { ProjectSettingsView } from './sidebar/project-settings-view';
import { ProjectNavigation } from './sidebar/project-navigation';
import {locateSessionEntry} from './inspector/session-inspection';
import { ContextPanel } from './inspector/context-panel';
import { useWorkspaceState } from './use-workspace-state';
import { useProjectSession } from './conversation/project-session/use-project-session';
import { useProjectSessionNavigation } from './sidebar/use-project-session-navigation';
import { selectedProjectId, type WorkspaceSelection } from './sidebar/workspace-selection';
import { api } from '../api/client';
import { resolveFileLink } from './conversation/file-link';
import { workspaceApi } from '../api/workspace-client';
import { WorkspaceCreateView } from './workspaces/workspace-create-view';
import { WorkspaceNavigation } from './workspaces/workspace-navigation';
import { WorkspaceSessionView } from './workspaces/workspace-session-view';
import { AuxiliaryDialog } from './auxiliary-dialog';
type ResourceKind='project'|'agent'|'mcp';
export function Workspace() {
  const state=useWorkspaceState();
  const [selection,setSelection]=useState<WorkspaceSelection|null>(null);
  const [scrollRevision,setScrollRevision]=useState(0);
  const selectionRef=useRef(selection);selectionRef.current=selection;
  const deleting=useRef(false),sessionLoadVersions=useRef(new Map<string,number>());
  const [deletingSessionId,setDeletingSessionId]=useState<string|null>(null);
  const [rolesOpen,setRolesOpen]=useState(false),[roleTarget,setRoleTarget]=useState<RoleTarget|null>(null);
  const [projectEditor,setProjectEditor]=useState<Project|null>(null);
  const [resourceKind,setResourceKind]=useState<ResourceKind|null>(null),[resourceId,setResourceId]=useState<string|null>(null);
  const [panelOpen,setPanelOpen]=useState(false),[panelView,setPanelView]=useState<'files'|'check'>('check'),[collapsed,setCollapsed]=useState(false);
  const [filePreview,setFilePreview]=useState<FilePreview|null>(null),[createProjectSessionOpen,setCreateProjectSessionOpen]=useState(false),[creatingProjectId,setCreatingProjectId]=useState<string|null>(null);
  const previewRequest=useRef(0);
  const [inspectionEntryId,setInspectionEntryId]=useState<string|null>(null),[workspaceInspectionOpen,setWorkspaceInspectionOpen]=useState(false);
  const [previewLocation,setPreviewLocation]=useState<{name:string;rootPath:string;line?:number}|null>(null);
  const creating=useRef(false),editorVersion=useRef(0);
  const settingsVersion=editorVersion.current;
  const navigation=useProjectSessionNavigation();
  const [workspaces,setWorkspaces]=useState<WorkspaceRecord[]>([]),[workspaceSessions,setWorkspaceSessions]=useState<Record<string,WorkspaceSessionDTO[]>>({}),[workspaceError,setWorkspaceError]=useState('');
  const [workspaceEditor,setWorkspaceEditor]=useState<WorkspaceRecord|'new'|null>(null),[newSessionWorkspace,setNewSessionWorkspace]=useState<WorkspaceRecord|null>(null),[defaultProject,setDefaultProject]=useState(''),[creatingWorkspaceSession,setCreatingWorkspaceSession]=useState(false),[sessionError,setSessionError]=useState('');
  const loadWorkspaces=useCallback(async()=>{try{setWorkspaces(await workspaceApi.list());setWorkspaceError('');}catch(cause){setWorkspaceError(cause instanceof Error?cause.message:'无法加载工作区');}},[]);
  const loadSessions=useCallback(async(id:string)=>{const version=(sessionLoadVersions.current.get(id)??0)+1;sessionLoadVersions.current.set(id,version);const sessions=await workspaceApi.sessions(id);if(sessionLoadVersions.current.get(id)===version)setWorkspaceSessions(current=>({...current,[id]:sessions}));},[]);
  useEffect(()=>{void loadWorkspaces();},[loadWorkspaces]);
  useEffect(()=>{if(selection?.kind==='workspace')void loadSessions(selection.workspaceId).catch(cause=>setWorkspaceError(cause.message));},[selection,loadSessions]);
  const project=state.projects.find(item=>item.id===selectedProjectId(selection))??null;
  const projectSession=useProjectSession(project,selection?.kind==='project'?selection.sessionId:undefined);
  useEffect(()=>{if(project&&projectSession.loadedProjectId===project.id)navigation.updateProjectSessions(project.id,projectSession.sessions);},[project,projectSession.loadedProjectId,projectSession.sessions,navigation.updateProjectSessions]);
  const workspace=selection?.kind==='workspace'?workspaces.find(item=>item.id===selection.workspaceId):undefined;
  const workspaceSession=selection?.kind==='workspace'?workspaceSessions[selection.workspaceId]?.find(item=>item.id===selection.sessionId):undefined;
  useEffect(()=>{closeAuxiliary();setInspectionEntryId(null);},[project?.id,projectSession.sessionId,workspaceSession?.id]);
  function closeAuxiliary(){previewRequest.current++;setPreviewLocation(null);setPanelOpen(false);setWorkspaceInspectionOpen(false);setFilePreview(null);}
  function closeDisplays(){editorVersion.current++;closeAuxiliary();setResourceKind(null);setResourceId(null);setProjectEditor(null);setCreateProjectSessionOpen(false);setRolesOpen(false);setRoleTarget(null);setWorkspaceEditor(null);setNewSessionWorkspace(null);}
  function select(next:WorkspaceSelection){closeDisplays();setInspectionEntryId(null);if(next.sessionId)setScrollRevision(value=>value+1);setSelection(next);}
  function openResource(kind:ResourceKind,id?:string){closeDisplays();if(kind==='agent'){setRolesOpen(true);return;}setResourceKind(kind);setResourceId(id??null);if(kind==='project')setProjectEditor(state.projects.find(item=>item.id===id)??null);if(kind==='mcp')setPanelOpen(true);}
  async function createProjectSession(id:string,body:Record<string,unknown>={}){if(creating.current)return;creating.current=true;setCreatingProjectId(id);try{const session=await navigation.createProjectSession(id,body);select({kind:'project',projectId:id,sessionId:session.id});}catch(cause){state.setError(cause instanceof Error?cause.message:'无法创建会话');}finally{creating.current=false;setCreatingProjectId(null);}}
  function openWorkspaceSession(value:WorkspaceRecord){closeDisplays();setNewSessionWorkspace(value);setDefaultProject(value.defaultProjectId);setSessionError('');}
  async function createWorkspaceSession(){if(!newSessionWorkspace||creatingWorkspaceSession)return;setCreatingWorkspaceSession(true);try{const value=await workspaceApi.createSession(newSessionWorkspace.id,defaultProject);await loadSessions(newSessionWorkspace.id);select({kind:'workspace',workspaceId:newSessionWorkspace.id,sessionId:value.id});}catch(cause){setSessionError(cause instanceof Error?cause.message:'无法创建会话');}finally{setCreatingWorkspaceSession(false);}}
  async function openFileLink(href:string) {
    const version=++previewRequest.current;
    try {
      const projects=workspace?workspace.projects:project?[project]:[];
      const target=resolveFileLink(href,projects,workspaceSession?.defaultProjectId??project?.id??'');
      const owner=projects.find(item=>item.id===target.projectId)!;
      const preview=workspace?await workspaceApi.readFile(workspace.id,owner.id,target.path):await api.readFile(owner.id,target.path);
      if(version!==previewRequest.current)return;
      setPreviewLocation({name:owner.name,rootPath:owner.rootPath,line:target.line});setFilePreview(preview);
      if(workspace){setPanelOpen(false);setWorkspaceInspectionOpen(false);}else{setResourceKind(null);setPanelView('files');setPanelOpen(true);}
    }catch(cause){if(version===previewRequest.current)state.setError(cause instanceof Error?cause.message:'无法预览文件');}
  }
  async function deleteSession(kind:'project'|'workspace',ownerId:string,id:string,label:string) {
    if(deleting.current||!window.confirm(`删除会话“${label}”？会话将移除，磁盘上的 Pi 历史和项目文件会保留。`))return;
    deleting.current=true;setDeletingSessionId(id);
    try {
      if(kind==='workspace'){
        await workspaceApi.deleteSession(ownerId,id);
        sessionLoadVersions.current.set(ownerId,(sessionLoadVersions.current.get(ownerId)??0)+1);
        setWorkspaceSessions(current=>({...current,[ownerId]:(current[ownerId]??[]).filter(item=>item.id!==id)}));
      }else{
        await api.deleteSession(ownerId,id);navigation.removeSession(ownerId,id);
        if(selectionRef.current?.kind==='project'&&selectionRef.current.projectId===ownerId)projectSession.removeDeletedSession(id);
      }
      const current=selectionRef.current;
      if(current?.sessionId===id&&current.kind===kind)select(kind==='workspace'?{kind:'workspace',workspaceId:ownerId}:{kind:'project',projectId:ownerId});
    }catch(cause){state.setError(cause instanceof Error?cause.message:'无法删除会话');}
    finally{deleting.current=false;setDeletingSessionId(null);}
  }
  const refreshWorkspaceSession=useCallback(async()=>{if(workspace)await loadSessions(workspace.id);},[workspace,loadSessions]);
  return <div className={`app-shell${collapsed?' app-shell--project-nav-collapsed':''}${roleTarget?' app-shell--agent-editor':''}`}>
    <div className="contents" onClickCapture={closeAuxiliary}><ProjectNavigation deletingSessionId={deletingSessionId} onDeleteSession={(ownerId,id,label)=>void deleteSession('project',ownerId,id,label)} projects={state.projects} selection={selection} navigation={navigation} creatingSessionProjectId={creatingProjectId} onNewProject={()=>openResource('project')} onNewProjectSession={()=>{closeDisplays();setCreateProjectSessionOpen(true);}} workspaceNavigation={<WorkspaceNavigation deletingSessionId={deletingSessionId} onDeleteSession={(ownerId,session)=>void deleteSession('workspace',ownerId,session.id,session.purpose.trim()||'新会话')} workspaces={workspaces} sessions={workspaceSessions} selectedWorkspaceId={selection?.kind==='workspace'?selection.workspaceId:undefined} selectedSessionId={selection?.kind==='workspace'?selection.sessionId:undefined} error={workspaceError} onRetry={()=>void loadWorkspaces()} onCreate={()=>{closeDisplays();setWorkspaceEditor('new');}} onSelect={id=>select({kind:'workspace',workspaceId:id})} onSession={(id,session)=>select({kind:'workspace',workspaceId:id,sessionId:session.id})} onNewSession={openWorkspaceSession} onEdit={value=>{closeDisplays();setWorkspaceEditor(value);}}/>} onCreateSession={id=>void createProjectSession(id)} onSessionSelect={(projectId,sessionId)=>select({kind:'project',projectId,sessionId})} onEditProject={id=>openResource('project',id)} onOpenResource={kind=>openResource(kind)}/></div>
    {roleTarget&&<RoleEditor key={roleTarget.resource?.id??'new'} target={roleTarget} projects={state.projects} onClose={()=>{setRoleTarget(null);setRolesOpen(true);}} onSaved={async()=>{await state.reload();setRoleTarget(null);setRolesOpen(true);}}/>}
    <section className="main-column"><div className="main-toolbar"><div className="main-toolbar__leading"><button className="project-nav-toggle" type="button" aria-label={collapsed?'展开项目导航':'收起项目导航'} aria-controls="project-navigation" aria-expanded={!collapsed} onClick={()=>{closeAuxiliary();setCollapsed(value=>!value);}}>{collapsed?<PanelLeftOpen size={16}/>:<PanelLeftClose size={16}/>}</button><span>{resourceKind==='project'?(projectEditor?.name??'新建项目'):workspaceEditor?(workspaceEditor==='new'?'新建工作区':workspaceEditor.name):workspace?.name??project?.name??'工作台'}</span></div>{project&&!workspaceEditor&&resourceKind!=='project'&&<div className="main-toolbar__actions"><nav className="main-toolbar__panel-switcher" aria-label="会话辅助工具">{(['files','check'] as const).map(view=><button key={view} type="button" aria-pressed={panelOpen&&panelView===view} disabled={view==='check'&&!projectSession.sessionId} onClick={()=>{previewRequest.current++;setPreviewLocation(null);setFilePreview(null);setResourceKind(null);setResourceId(null);setPanelView(view);setPanelOpen(true);}}>{{files:'文件',check:'会话检查'}[view]}</button>)}</nav>{panelOpen&&<button className="main-toolbar__close" aria-label="关闭辅助弹窗" onClick={closeAuxiliary}><X size={15}/></button>}</div>}</div><div className="main-canvas">
      {resourceKind==='project'?<ProjectSettingsView key={resourceId??'new'} project={projectEditor} onClose={closeDisplays} onSave={async body=>{const current=projectEditor;const saved=current?await api.updateProject(current.id,body,current.writeETag):await api.createProject(body);await state.reload();if(editorVersion.current===settingsVersion){select({kind:'project',projectId:saved.id});if(!current){setResourceKind('project');setResourceId(saved.id);setProjectEditor(saved);}}}} onDelete={async id=>{await api.deleteProject(id,projectEditor?.writeETag);await state.reload();if(editorVersion.current===settingsVersion){if(selectionRef.current?.kind==='project'&&selectionRef.current.projectId===id)setSelection(null);closeDisplays();}}}/>:workspaceEditor?<WorkspaceCreateView key={workspaceEditor==='new'?'new':workspaceEditor.id} workspace={workspaceEditor==='new'?undefined:workspaceEditor} onClose={closeDisplays} onSave={async(body,key)=>{const current=workspaceEditor==='new'?null:workspaceEditor;const saved=await workspaceApi.save(current?.id??null,body,current?.writeETag,key);await loadWorkspaces();if(editorVersion.current===settingsVersion)select({kind:'workspace',workspaceId:saved.id});}}/>:workspace&&workspaceSession?<WorkspaceSessionView scrollRevision={scrollRevision} inspectionOpen={workspaceInspectionOpen} onInspectionChange={open=>{closeAuxiliary();setWorkspaceInspectionOpen(open);}} onOpenFileLink={href=>void openFileLink(href)} key={workspaceSession.id} workspace={workspace} session={workspaceSession} onChanged={refreshWorkspaceSession}/>:workspace?<main className="flex flex-1 flex-col gap-4 overflow-auto bg-white p-6"><header className="flex items-center justify-between"><h1 className="text-xl font-semibold text-slate-800">{workspace.name}</h1><button className="rounded-md bg-emerald-700 px-3 py-2 text-sm text-white" onClick={()=>openWorkspaceSession(workspace)}>新建会话</button></header><div className="overflow-hidden rounded-lg border border-slate-200">{workspace.projects.map(item=><div key={item.id} className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0"><span className="text-sm font-medium">{item.name}</span>{item.id===workspace.defaultProjectId&&<span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">默认项目</span>}<span className="min-w-0 break-all font-mono text-xs text-slate-500">{item.rootPath}</span></div>)}</div></main>:project?<ProjectSessionView scrollRevision={scrollRevision} onOpenFileLink={href=>void openFileLink(href)} project={project} session={projectSession}/>:<main className="surface"><div className="empty-state"><h1>{state.loading?'正在加载…':'选择工作区或独立项目'}</h1><p>从左侧创建工作区，或打开已有会话。</p></div></main>}
    </div></section>
    {filePreview&&workspace&&previewLocation&&<AuxiliaryDialog title="文件" onClose={()=>{previewRequest.current++;setFilePreview(null);setPreviewLocation(null);}}><div className="h-[70vh]"><FilePreviewPane projectName={previewLocation?.name??project!.name} rootPath={previewLocation?.rootPath??project!.rootPath} line={previewLocation?.line} preview={filePreview} onClose={()=>{previewRequest.current++;setFilePreview(null);setPreviewLocation(null);}}/></div></AuxiliaryDialog>}
    <RoleDirectory open={rolesOpen&&!roleTarget} roles={state.agents} onRefresh={state.reload} onClose={()=>setRolesOpen(false)} onEdit={target=>{setRolesOpen(false);setRoleTarget(target);}}/>
    {panelOpen&&project&&<ContextPanel key={`${project.id}:${projectSession.sessionId}:${panelView}`} onFork={created=>select({kind:'project',projectId:project.id,sessionId:created.id})} visible={!roleTarget} panelView={panelView} selectedProject={project} session={projectSession} resourceKind={resourceKind} resourceId={resourceId} selectedResource={resourceKind==='mcp'?state.mcps.find(item=>item.id===resourceId)??null:null} projects={state.projects} agents={state.agents} mcps={state.mcps} selected={inspectionEntryId??projectSession.tree.activeLeafId} onSelect={setInspectionEntryId} onLocate={id=>{closeAuxiliary();const current=selectionRef.current;requestAnimationFrame(()=>{if(current!==selectionRef.current)return;if(!locateSessionEntry(id)){state.setError('节点当前不可用，已刷新会话树。');void projectSession.refresh();}});}} initialPreview={filePreview} previewLine={previewLocation?.line} onClose={closeAuxiliary} onOpenFile={preview=>{previewRequest.current++;setPreviewLocation(null);setFilePreview(preview);}} onOpenResource={openResource} onSaveResource={(kind,id,body)=>void state.saveResource(kind,id,body)} onDeleteResource={(kind,id)=>void state.deleteResource(kind,id)}/>}
    {createProjectSessionOpen&&<ProjectSessionCreateDialog projects={state.projects.filter(p=>p.status==='active')} creatingProjectId={creatingProjectId} onClose={()=>setCreateProjectSessionOpen(false)} onSelectProject={(id,body)=>void createProjectSession(id,body)} onCreateProject={()=>openResource('project')}/>}
    {newSessionWorkspace&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-5"><section role="dialog" aria-modal="true" aria-labelledby="workspace-session-title" className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"><h2 id="workspace-session-title" className="text-lg font-semibold">新建工作区会话</h2><label className="mt-4 block text-sm">默认工作目录<select className="mt-2 block w-full rounded-md border border-slate-200 p-2" value={defaultProject} disabled={creatingWorkspaceSession} onChange={event=>setDefaultProject(event.target.value)}>{newSessionWorkspace.projects.map(p=><option key={p.id} value={p.id}>{p.name} · {p.rootPath}</option>)}</select></label>{sessionError&&<p role="alert" className="mt-3 text-sm text-red-700">{sessionError}</p>}<footer className="mt-5 flex justify-end gap-3"><button disabled={creatingWorkspaceSession} onClick={()=>setNewSessionWorkspace(null)}>取消</button><button disabled={creatingWorkspaceSession} className="rounded-md bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-40" onClick={()=>void createWorkspaceSession()}>{creatingWorkspaceSession?'创建中…':'创建会话'}</button></footer></section></div>}
    {state.error&&<button className="error-banner" onClick={()=>state.setError('')}>{state.error}<Trash2 size={13}/></button>}
  </div>;
}
