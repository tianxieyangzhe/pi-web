import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceRecord, WorkspaceSessionDTO } from '../../../src/domain/workspace';
import { workspaceApi } from '../../api/workspace-client';
import { AuxiliaryDialog } from '../auxiliary-dialog';
import { SessionInspection,locateSessionEntry } from '../inspector/session-inspection';
import { useSessionTree } from '../conversation/use-session-tree';
import { SessionConversationView } from '../conversation/session-conversation-view';
import { NativeContextSection } from '../inspector/native-context-section';
import { SessionModelSettings } from '../inspector/session-model-settings';

export function WorkspaceSessionView({ scrollRevision, onOpenFileLink, workspace, session: initial, onChanged, inspectionOpen: panel, onInspectionChange:setPanel }: {
  scrollRevision?:number;
  onOpenFileLink?: (href:string)=>void;
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
  const [pending, setPending] = useState<Array<{ key: string }> | null>(null);
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
  const recover = async (action: 'inspect' | 'acknowledge-unknown') => {
    try {
      const result = await workspaceApi.recover(workspace.id, initial.id, action);
      setPending(result.pending);
      await tree.refresh();
      if (action === 'acknowledge-unknown') tree.retryOpen();
    } catch (cause) { tree.setError(cause instanceof Error ? cause.message : '核对失败'); }
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
    ready: tree.ready && current.allowedActions.includes('send'),
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
        <button type="button" aria-pressed={panel} onClick={()=>setPanel(!panel)}>会话检查</button>
      </nav></div></div>
      <SessionConversationView scrollRevision={scrollRevision} onOpenFileLink={onOpenFileLink} title={workspace.name} label="工作区会话"
        purpose={`${current.purpose} · 默认目录：${workspace.projects.find(p => p.id === current.defaultProjectId)?.rootPath ?? ''}`}
        session={controller} referenceProjects={projects} listReferenceFiles={listFiles} />
    </section>
    {panel&&<AuxiliaryDialog title="会话检查" onClose={()=>setPanel(false)}><SessionInspection tree={tree.tree} selected={selected} onSelect={setSelected} onLocate={id=>{setPanel(false);requestAnimationFrame(()=>locateSessionEntry(id));}} settings={<>
      <section><h3 className="mb-2 font-semibold">Session</h3><p>{current.purpose.trim()||'新会话'}</p><p className="mt-1 break-all text-xs text-slate-500">{initial.id} · {tree.connection==='open'?'打开':'关闭'}</p></section>
      <SessionModelSettings modelApi={modelApi} leaseId={tree.leaseId} onApplied={async()=>{await tree.refresh();await onChanged();tree.retryOpen();}}/>
      <NativeContextSection eventRevision={tree.eventRevision} projectId={`workspace:${workspace.id}`} sessionId={initial.id} running={tree.running} onBusy={setCompacting} onRestore={async()=>{if(await perform('restore'))tree.retryOpen();}} contextApi={contextApi}/><section className="space-y-2 border-t border-slate-100 pt-4"><h3 className="font-semibold">待核对操作</h3><button className="text-xs underline" disabled={tree.running} onClick={()=>void recover('inspect')}>核对未确认请求</button>{pending&&<p>{pending.length?`${pending.length} 个请求结果待核对`:'没有待核对请求'}</p>}{!!pending?.length&&<button className="block text-amber-800 underline" disabled={tree.running} onClick={()=>{if(window.confirm('确认承认上述请求结果未知？旧输入不会重新执行。'))void recover('acknowledge-unknown');}}>承认结果未知并解除阻塞</button>}</section>
    </>}/></AuxiliaryDialog>}
  </div>;
}
