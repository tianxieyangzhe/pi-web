import {Button} from '../../components/button';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { WorkspaceRecord, WorkspaceSessionDTO } from '../../../src/domain/workspace';
import { workspaceApi } from '../../api/workspace-client';
import {SessionFileChanges} from '../files/session-file-changes';
import { AuxiliaryDialog } from '../auxiliary-dialog';
import { SessionInspection,locateSessionEntry } from '../inspector/session-inspection';
import { useSessionTree } from '../conversation/use-session-tree';
import { SessionConversationView } from '../conversation/session-conversation-view';
import { NativeContextSection } from '../inspector/native-context-section';
import { SessionModelSettings } from '../inspector/session-model-settings';
import {FileBrowser,FilePreviewPane} from '../files/file-browser';
import type {FilePreview} from '../../domain/models';

export function WorkspaceSessionView({ scrollRevision, onOpenFileLink, workspace, session: initial, onChanged, inspectionOpen: panel, onInspectionChange:setPanel,filesOpen,onFilesChange,changesOpen,onChangesChange }:  {
  scrollRevision?:number;
  onOpenFileLink?: (href:string)=>void;
  changesOpen:boolean;
  onChangesChange:(open:boolean)=>void;
  filesOpen:boolean;
  onFilesChange:(open:boolean)=>void;
  inspectionOpen:boolean;
  onInspectionChange:(open:boolean)=>void;
  workspace: WorkspaceRecord;
  session: WorkspaceSessionDTO;
  onChanged: () => Promise<void>;
}) {
  const [current, setCurrent] = useState(initial);
  const [stopping, setStopping] = useState(false);
  const [, setCompacting] = useState(false);
  const [selected,setSelected]=useState<string|null>(null);
  const [filesProjectId,setFilesProjectId]=useState<string|null>(initial.defaultProjectId);
  const [filePreview,setFilePreview]=useState<{projectId:string;preview:FilePreview}|null>(null);
  const fileTabsId=useId();
  const fileProject=workspace.projects.find(p=>p.id===filesProjectId)??workspace.projects.find(p=>p.id===current.defaultProjectId)??workspace.projects[0];
  function selectFileProject(id:string){if(id!==fileProject?.id){setFilePreview(null);setFilesProjectId(id);}}
  const previewProject=workspace.projects.find(p=>p.id===filePreview?.projectId);
  const fileApi=useMemo(()=>fileProject?{list:(path:string)=>workspaceApi.files(workspace.id,fileProject.id,path),read:(path:string)=>workspaceApi.readFile(workspace.id,fileProject.id,path),changes:()=>workspaceApi.projectChanges(workspace.id,fileProject.id)}:undefined,[workspace.id,fileProject?.id,fileProject?.rootPath]);
  useEffect(()=>{if(!filesOpen){setFilePreview(null);setFilesProjectId(initial.defaultProjectId);} },[filesOpen,initial.defaultProjectId]);
  const base = workspaceApi.session(workspace.id, initial.id);
  const tree = useSessionTree(base, () => workspaceApi.messages(workspace.id, initial.id), onChanged);
  const identity = useRef(initial.id);
  identity.current = initial.id;
  useEffect(() => { setCurrent(initial); }, [initial]);

  const perform = async (action: string) => {
    const id = initial.id;
    try {
      const updated = await workspaceApi.action(workspace.id, id, action);
      if (identity.current === id && updated.id) setCurrent(updated);
      await onChanged();
      return true;
    } catch (cause) {
      if (identity.current === id) tree.setError(cause instanceof Error ? cause.message : '操作失败');
      return false;
    }
  };
  const modelApi=useMemo(()=>({load:()=>workspaceApi.models(workspace.id,initial.id,tree.leaseId??undefined),apply:(provider:string,modelId:string,thinkingLevel?:import('../../../src/domain/session-tools').SessionThinkingLevel)=>workspaceApi.switchModel(workspace.id,initial.id,provider,modelId,tree.leaseId!,thinkingLevel)}),[workspace.id,initial.id,tree.leaseId,tree.running]);
  const contextApi = useMemo(() => ({
    inspect: () => workspaceApi.context(workspace.id, initial.id),
    compact: () => workspaceApi.compact(workspace.id, initial.id),
    cancel: () => workspaceApi.compact(workspace.id, initial.id, true),
  }), [workspace.id, initial.id]);
  const projects = useMemo(() => workspace.projects.map(project => ({
    ...project, description: null, kind: 'code' as const, status: 'active' as const,
  })), [workspace.projects]);
  const listFiles = useCallback((projectId: string, path: string) => workspaceApi.files(workspace.id, projectId, path), [workspace.id]);
  const controller = {
    ...tree, sessionId: initial.id, stopping, compacting:tree.compacting,
    ready: tree.ready && (current.allowedActions.includes('send') || current.allowedActions.includes('steer')),
    send: async (text: string, references?: import('../../../src/domain/message-references').MessageReference[], webSearch?: boolean, toolSearch?: boolean) => {
      try { await tree.send(text, references, webSearch, toolSearch); }
      catch (cause) { tree.setError(cause instanceof Error ? cause.message : '消息发送失败'); throw cause; }
    },
    interrupt: async () => { setStopping(true); try { await perform('interrupt'); } finally { setStopping(false); } },
    end: async () => { tree.close();await perform('end'); },
  };
  return <div className="flex min-h-0 flex-1 overflow-hidden">
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="main-toolbar"><div className="main-toolbar__leading"><span>{workspace.name}</span></div><div className="main-toolbar__actions"><nav className="main-toolbar__panel-switcher" aria-label="会话辅助工具">
        <Button variant="primary" type="button" aria-pressed={changesOpen} onClick={()=>onChangesChange(!changesOpen)}>本轮变更</Button>
        <Button variant="primary" type="button" aria-pressed={filesOpen} disabled={!workspace.projects.length} onClick={()=>{setFilePreview(null);setFilesProjectId(workspace.projects.some(p=>p.id===current.defaultProjectId)?current.defaultProjectId:workspace.projects[0]?.id??null);onFilesChange(!filesOpen);}}>文件检查</Button>
        <Button variant="primary" type="button" aria-pressed={panel} onClick={()=>setPanel(!panel)}>会话检查</Button>
      </nav></div></div>
      <SessionConversationView assistantProjectId={current.defaultProjectId} assistantWorkspaceId={workspace.id} scrollRevision={scrollRevision} onOpenFileLink={onOpenFileLink} title={workspace.name} label="工作区会话"
        purpose={`${current.purpose} · 默认目录：${workspace.projects.find(p => p.id === current.defaultProjectId)?.rootPath ?? ''}`}
        session={controller} referenceProjects={projects} listReferenceFiles={listFiles} />
    </section>
    {changesOpen&&<AuxiliaryDialog title="本轮变更" onClose={()=>onChangesChange(false)}><SessionFileChanges base={base} running={tree.running} revision={tree.eventRevision}/></AuxiliaryDialog>}
    {filesOpen&&<AuxiliaryDialog title="文件检查" onClose={()=>onFilesChange(false)}><div className="flex h-[70vh] min-h-0 min-w-0 flex-col">
      <div role="tablist" aria-label="工作区项目" className="flex shrink-0 overflow-x-auto border-b border-slate-200 px-4 pt-2">
        {workspace.projects.map((project,index)=><Button variant="tab" key={project.id} type="button" role="tab" id={`${fileTabsId}-${project.id}-tab`} aria-selected={fileProject?.id===project.id} aria-controls={`${fileTabsId}-panel`} tabIndex={fileProject?.id===project.id?0:-1} title={project.name} onClick={()=>selectFileProject(project.id)} onKeyDown={event=>{
          if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
          event.preventDefault();const count=workspace.projects.length,nextIndex=event.key==='Home'?0:event.key==='End'?count-1:(index+(event.key==='ArrowRight'?1:-1)+count)%count,next=workspace.projects[nextIndex];
          selectFileProject(next.id);document.getElementById(`${fileTabsId}-${next.id}-tab`)?.focus();
        }}><span className="max-w-40 truncate">{project.name}</span></Button>)}
      </div>
      {fileProject&&fileApi?<div role="tabpanel" id={`${fileTabsId}-panel`} aria-labelledby={`${fileTabsId}-${fileProject.id}-tab`} tabIndex={0} className="flex min-h-0 min-w-0 flex-1">
        <div className={`${filePreview&&previewProject?'hidden w-1/3 min-w-52 border-r border-slate-200 md:block':'w-full'} min-h-0 overflow-auto`}>
          <FileBrowser key={`${workspace.id}:${fileProject.id}:${fileProject.rootPath}`} projectId={fileProject.id} projectName={fileProject.name} rootPath={fileProject.rootPath} fileApi={fileApi} onOpenFile={preview=>setFilePreview({projectId:fileProject.id,preview})}/>
        </div>
        {filePreview&&previewProject&&<div className="min-w-0 flex-1"><FilePreviewPane onSetReference={()=>tree.addContextFiles([{projectId:previewProject.id,path:filePreview.preview.path}])} referenceDisabled={!controller.ready||tree.running||tree.compacting||stopping||!tree.leaseId} referenced={tree.contextFiles.some(file=>file.projectId===previewProject.id&&file.path===filePreview.preview.path)} key={`${previewProject.id}:${filePreview.preview.path}`} projectName={previewProject.name} rootPath={previewProject.rootPath} preview={filePreview.preview} onClose={()=>setFilePreview(null)} onDownload={()=>workspaceApi.downloadFile(workspace.id,previewProject.id,filePreview.preview.path)} loadPdf={signal=>workspaceApi.readFileBlob(workspace.id,previewProject.id,filePreview.preview.path,signal)}/></div>}
      </div>:<p className="p-4 text-xs text-slate-500">工作区暂无项目。</p>}
    </div></AuxiliaryDialog>}
    {panel&&<AuxiliaryDialog title="会话检查" onClose={()=>setPanel(false)}><SessionInspection tree={tree.tree} selected={selected} onSelect={setSelected} onLocate={id=>{setPanel(false);requestAnimationFrame(()=>locateSessionEntry(id));}} settings={<>
      <section><h3 className="mb-2 font-semibold">Session</h3><p>{current.purpose.trim()||'新会话'}</p><p className="mt-1 break-all text-xs text-slate-500">{initial.id} · {tree.connection==='open'?'打开':'关闭'}</p></section>
      <SessionModelSettings modelApi={modelApi} leaseId={tree.leaseId} onApplied={async()=>{await tree.modelApplied();await onChanged();}}/>
      <NativeContextSection eventRevision={tree.eventRevision} projectId={`workspace:${workspace.id}`} sessionId={initial.id} running={tree.running} onBusy={setCompacting} onRestore={async()=>{if(await perform('restore'))tree.retryOpen();}} contextApi={contextApi}/>
    </>}/></AuxiliaryDialog>}
  </div>;
}
