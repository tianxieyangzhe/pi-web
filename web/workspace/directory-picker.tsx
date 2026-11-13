import { ErrorToast } from './conversation/error-toast';
import {Button} from '../components/button';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Folder,X} from 'lucide-react';
import {workspaceApi} from '../api/workspace-client';
import type {DirectoryListing} from '../../src/application/ports/workspace';
export function DirectoryPicker({ onSelect, onClose }: { onSelect: (path: string) => void; onClose: () => void }) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pathInput, setPathInput] = useState('');
  const [target, setTarget] = useState<{ path?: string }>({});
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    workspaceApi.directories(target.path)
      .then(value => { if (active) { setListing(value); setPathInput(value.path); } })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '无法读取目录'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [target]);
  function navigate(path: string) {
    setPathInput(path);
    setLoading(true);
    setTarget({ path });
  }
  return <dialog ref={dialog} className="m-auto w-[min(44rem,90vw)] rounded-xl border border-slate-200 bg-white p-5 text-slate-700 shadow-xl backdrop:bg-slate-900/30" onClose={onClose} aria-label="选择项目目录">
    <header className="mb-4 flex items-center justify-between">
      <h2 className="text-base font-semibold">选择项目目录</h2>
      <Button variant="ghost" size="icon" type="button" aria-label="关闭目录选择器" onClick={onClose}><X size={18}/></Button>
    </header>
    <form className="mb-3 flex items-end gap-2" onSubmit={event => { event.preventDefault(); if (pathInput.trim() && !loading) navigate(pathInput.trim()); }}>
      <label className="min-w-0 flex-1 text-sm" htmlFor="workspace-directory-path">目录路径
        <input id="workspace-directory-path" type="text" value={pathInput} disabled={loading} autoComplete="off" spellCheck={false}
          placeholder="输入或粘贴绝对路径" onChange={event => setPathInput(event.target.value)}
          className="mt-2 block w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm outline-none focus:border-emerald-600 disabled:opacity-50"/>
      </label>
      <Button variant="primary" type="submit" disabled={loading || !pathInput.trim()} >跳转</Button>
    </form>
    <div className="mb-3 flex items-center gap-2">
      <Button variant="ghost" size="icon" type="button" disabled={!listing?.parent || loading} onClick={() => listing?.parent && navigate(listing.parent)} aria-label="上一级目录"><ArrowLeft size={16}/></Button>
      <span className="min-w-0 break-all font-mono text-xs">{listing?.path ?? '正在读取目录…'}</span>
    </div>
    <div className="max-h-80 min-h-40 overflow-auto rounded-lg border border-slate-200">
      {loading ? <p className="p-3 text-sm" role="status">正在加载…</p> : !error && listing?.directories.map(entry =>
        <Button variant="ghost" size="row" key={entry.path} type="button"  onClick={() => navigate(entry.path)}><Folder size={15}/>{entry.name}</Button>)}
    </div>
    <ErrorToast message={error} onDismiss={()=>setError('')}/>
    <footer className="mt-4 flex justify-end gap-2">
      <Button type="button"  onClick={onClose}>取消</Button>
      <Button variant="primary" type="button"
        disabled={!listing || loading || !!error || pathInput.trim() !== listing.path} onClick={() => listing && onSelect(listing.path)}>选择此目录</Button>
    </footer>
  </dialog>;
}
