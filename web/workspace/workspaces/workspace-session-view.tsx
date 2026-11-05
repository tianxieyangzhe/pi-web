import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceRecord, WorkspaceSessionDTO } from '../../../src/domain/workspace';
import type { SessionMemoryContext } from '../../domain/session-memory';
import { workspaceApi, type WorkspaceMemoryView } from '../../api/workspace-client';
import { useSessionTree } from '../conversation/use-session-tree';
import { SessionConversationView } from '../conversation/session-conversation-view';
import { NativeContextSection } from '../inspector/native-context-section';
import { SessionMemoryContextEditor, memoryLabels } from '../inspector/session-memory-context-editor';

export function WorkspaceSessionView({ onOpenFileLink, workspace, session: initial, onChanged }: {
  onOpenFileLink?: (href:string)=>void;
  workspace: WorkspaceRecord;
  session: WorkspaceSessionDTO;
  onChanged: () => Promise<void>;
}) {
  const [current, setCurrent] = useState(initial);
  const [stopping, setStopping] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [panel, setPanel] = useState<'check' | 'memory' | null>(null);
  const [memory, setMemory] = useState<WorkspaceMemoryView | null>(null);
  const [memoryError, setMemoryError] = useState('');
  const [draft, setDraft] = useState<SessionMemoryContext | null>(null);
  const [saving, setSaving] = useState(false);
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
  const readMemory = useCallback(async () => {
    try {
      setMemory(await workspaceApi.memory(workspace.id, initial.id));
      setMemoryError('');
    } catch (cause) { setMemoryError(cause instanceof Error ? cause.message : '无法读取记忆'); }
  }, [workspace.id, initial.id]);
  useEffect(() => {
    if (panel !== 'memory' || draft) return;
    void readMemory();
    const timer = setInterval(() => void readMemory(), 5000);
    return () => clearInterval(timer);
  }, [panel, readMemory, draft]);
  const saveMemory = async () => {
    if (!draft || !memory) return;
    setSaving(true);
    try {
      setMemory(await workspaceApi.changeMemory(workspace.id, initial.id, draft, memory.writeETag));
      setDraft(null);
      setMemoryError('');
      await onChanged();
    } catch (cause) { setMemoryError(cause instanceof Error ? cause.message : '无法保存记忆'); }
    finally { setSaving(false); }
  };
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
    ...tree, sessionId: initial.id, stopping, compacting,
    ready: tree.ready && current.allowedActions.includes('send'),
    send: async (text: string, references?: import('../../../src/domain/message-references').MessageReference[]) => {
      try { await tree.send(text, references); }
      catch (cause) { tree.setError(cause instanceof Error ? cause.message : '消息发送失败'); throw cause; }
    },
    interrupt: async () => { setStopping(true); try { await perform('interrupt'); } finally { setStopping(false); } },
    end: async () => { await perform('end'); },
  };
  return <div className="flex min-h-0 flex-1 overflow-hidden">
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex justify-end gap-2 border-b border-slate-100 px-4 py-2 text-xs">
        <button className="rounded px-2 py-1 hover:bg-slate-100" aria-pressed={panel === 'memory'} onClick={() => setPanel(value => value === 'memory' ? null : 'memory')}>记忆</button>
        <button className="rounded px-2 py-1 hover:bg-slate-100" aria-pressed={panel === 'check'} onClick={() => setPanel(value => value === 'check' ? null : 'check')}>检查</button>
      </div>
      <SessionConversationView onOpenFileLink={onOpenFileLink} title={workspace.name} label="工作区会话"
        purpose={`${current.purpose} · 默认目录：${workspace.projects.find(p => p.id === current.defaultProjectId)?.rootPath ?? ''}`}
        session={controller} ended={!!current.endedAt} referenceProjects={projects} listReferenceFiles={listFiles} />
    </section>
    {panel && <aside className="w-80 shrink-0 overflow-auto border-l border-slate-200 bg-white p-4 text-sm">
      {panel === 'check' ? <>
        <NativeContextSection projectId={`workspace:${workspace.id}`} sessionId={initial.id} running={tree.running} onBusy={setCompacting}
          onRestore={async () => { if (await perform('restore')) tree.retryOpen(); }} contextApi={contextApi} />
        <div className="mt-5 flex flex-col items-start gap-2 border-t border-slate-100 pt-4">
          <button className="text-xs text-slate-600 underline" disabled={tree.running} onClick={() => void recover('inspect')}>核对未确认请求</button>
          {pending && <p className="text-xs text-slate-600">{pending.length ? `${pending.length} 个请求缺少确定的结束证据，请核对会话中的 Pi 历史和工具结果。` : '没有待核对请求。'}</p>}
          {pending?.map(request => <code key={request.key} className="break-all text-xs text-slate-500">{request.key}</code>)}
          {!!pending?.length && <button className="text-xs text-amber-800 underline" disabled={tree.running} onClick={() => void recover('acknowledge-unknown')}>承认上述请求结果未知并解除阻塞</button>}
        </div>
      </> : <>
        <h2 className="font-medium">会话记忆</h2>
        {memoryError && <p role="alert" className="mt-3 text-red-700">{memoryError}</p>}
        {draft ? <div className="mt-4">
          <SessionMemoryContextEditor workspace value={draft} onChange={setDraft} disabled={saving} />
          <div className="mt-4 flex gap-3 text-xs"><button disabled={saving} className="text-emerald-800 underline" onClick={() => void saveMemory()}>{saving ? '保存中…' : '保存校正'}</button><button disabled={saving} onClick={() => setDraft(null)}>取消</button></div>
        </div> : memory ? <div className="mt-4 space-y-4">
          {(Object.keys(memoryLabels) as Array<keyof SessionMemoryContext>).map(key => {
            const value = memory.sessionMemory.contextJson[key];
            return <section key={key}><h3 className="mb-1 text-xs text-slate-500">{memoryLabels[key]}</h3><p className="whitespace-pre-wrap text-sm text-slate-700">{Array.isArray(value) ? value.map(item => typeof item === 'string' ? item : `${item.title}：${item.summary}`).join('\n') || '暂无' : value || '暂无'}</p></section>;
          })}
          <p className="text-xs text-slate-400">{memory.syncState === 'updating' ? '正在总结…' : memory.syncState === 'failed' ? '总结未完成，已保存内容保留' : '仅供展示，不进入模型提示词'}</p>
          <div className="flex gap-3 text-xs text-emerald-800 underline"><button onClick={() => void readMemory()}>刷新</button><button onClick={() => setDraft(structuredClone(memory.sessionMemory.contextJson))}>人工校正</button><button disabled={!memory.canSummarize} onClick={async () => { try { setMemory(await workspaceApi.summarizeMemory(workspace.id, initial.id)); setMemoryError(''); } catch(cause) { setMemoryError(cause instanceof Error ? cause.message : '总结失败'); } }}>立即总结</button></div>
        </div> : <p className="mt-4 text-slate-400">正在读取记忆…</p>}
      </>}
    </aside>}
  </div>;
}
