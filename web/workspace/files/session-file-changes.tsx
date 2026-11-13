import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/button';
import { ErrorToast } from '../conversation/error-toast';
import type { FileChangeContent, SessionFileChanges as Changes } from '../../../src/domain/session-file-changes';

async function read<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? '无法读取原生编辑差异');
  return payload.data;
}
const projectDirectoryName = (value: string | null) => value ? value.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || value : '项目范围外或路径未知';
const statuses = { not_recorded: '尚无编辑记录', boundary_unavailable: '无法确认本轮范围', running: '本轮执行中', recorded: '本轮原生编辑记录' };
export function SessionFileChanges({ base, running, revision = 0 }: { base: string; running: boolean; revision?: number }) {
  const [view, setView] = useState<Changes | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<FileChangeContent | null>(null);
  const [error, setError] = useState(''), [reload, setReload] = useState(0), [loading, setLoading] = useState(true);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const runRef = useRef<string | null>(null);
  useEffect(() => {
    let disposed = false, pending = false, timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setError(''); setLoading(true);
    async function load() {
      if (disposed || pending || document.hidden) return;
      pending = true;
      try {
        const next = await read<Changes>(`${base}/changes`, controller.signal);
        if (disposed) return;
        if (runRef.current !== next.runId) { setSelected(null); setContent(null); }
        runRef.current = next.runId; setView(next);
        if (selectedRef.current && !next.files.some(file => file.id === selectedRef.current)) { setSelected(null); setContent(null); }
        setError('');
        if (next.status === 'running' || running) timer = setTimeout(() => { void load(); }, 3000);
      } catch (cause) { if (!disposed) { setError(cause instanceof Error ? cause.message : '无法读取原生编辑差异'); if (running) timer = setTimeout(() => { void load(); }, 3000); } }
      finally { pending = false; if (!disposed) setLoading(false); }
    }
    const visible = () => { if (!document.hidden) { if (timer) clearTimeout(timer); void load(); } };
    void load(); document.addEventListener('visibilitychange', visible);
    return () => { disposed = true; controller.abort(); if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [base, running, revision, reload]);
  useEffect(() => {
    setContent(null);
    if (!view?.runId || !selected) return;
    const controller = new AbortController(); let disposed = false;
    void read<FileChangeContent>(`${base}/changes/content?${new URLSearchParams({ runId: view.runId, fileId: selected })}`, controller.signal).then(value => { if (!disposed) setContent(value); }).catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : '无法读取原生编辑差异'); });
    return () => { disposed = true; controller.abort(); };
  }, [base, selected, view]);
  const file = view?.files.find(value => value.id === selected);
  const projectGroups = new Map<string | null, Changes['files']>();
  for (const item of view?.files ?? []) {
    const files = projectGroups.get(item.projectPath) ?? [];
    files.push(item); projectGroups.set(item.projectPath, files);
  }
  return <div className="flex h-[70vh] min-h-0 flex-col text-sm">
    <div className="shrink-0 space-y-2 border-b border-slate-200 px-5 py-3">
      <div className="flex items-center justify-between gap-3"><span>{view ? statuses[view.status] : '正在读取原生编辑差异…'}{view?.files.length ? ` · ${view.files.length} 个文件` : ''}</span><Button type="button" onClick={() => setReload(value => value + 1)}>刷新</Button></div>
      <p className="text-xs text-slate-500">仅展示 Pi 在本轮记录的原生编辑差异。同一文件多次编辑依次保留；write 和 bash 操作可能没有差异记录。</p>
      {view?.notice && <p className="text-xs text-amber-700">{view.notice}</p>}
    </div>
    <ErrorToast message={error} onRetry={() => setReload(value => value + 1)} onDismiss={() => setError('')} />
    {view?.files.length ? <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className="max-h-48 min-w-0 shrink-0 overflow-x-hidden overflow-y-auto border-b border-slate-200 md:max-h-none md:w-64 md:border-r md:border-b-0"><div className="space-y-3 p-2">{[...projectGroups].map(([projectPath, files]) => <section key={projectPath ?? 'unknown'} aria-label={projectPath ?? '项目范围外或路径未知'} className="min-w-0"><div title={projectPath ?? undefined} className="w-full min-w-0 px-2 py-2"><h3 className="pointer-events-none m-0 truncate font-mono text-xs font-semibold leading-5 text-slate-700">{projectDirectoryName(projectPath)}</h3></div><ul className="m-0 list-none p-0">{files.map(item => <li key={item.id} className="min-w-0"><Button variant="ghost" size="row" type="button" title={item.path} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><span className="min-w-0 flex-1 truncate font-mono text-xs">{item.path}</span></Button></li>)}</ul></section>)}</div></div>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">{file ? <div className="space-y-3"><div className="space-y-1"><div title={file.projectPath ?? undefined} className="w-full min-w-0"><span className="pointer-events-none block truncate font-mono text-xs text-slate-500">{projectDirectoryName(file.projectPath)}</span></div><div className="break-all font-mono text-xs">{file.path}</div></div>{content ? content.edits.map((edit, index) => <div key={edit.entryId} className="space-y-1">
        {content.edits.length > 1 && <p className="text-xs text-slate-500">第 {index + 1} 次编辑</p>}
        <pre aria-label={`原生编辑差异 ${index + 1}`} className="m-0 overflow-x-auto font-mono text-xs leading-5">{edit.patch.split('\n').map((line, i) => <span key={i} className={`block min-h-5 ${line.startsWith('+') ? 'bg-emerald-50 text-emerald-800' : line.startsWith('-') ? 'bg-red-50 text-red-800' : 'text-slate-600'}`}>{line || ' '}</span>)}</pre>
      </div>) : <p className="text-xs text-slate-500">正在读取原生编辑差异…</p>}</div> : <p className="text-slate-500">选择文件查看原生编辑差异。</p>}</div>
    </div> : !loading && view && !view.notice && <p className="p-5 text-slate-500">本轮尚无原生编辑差异记录。这不代表文件没有变化。</p>}
  </div>;
}
