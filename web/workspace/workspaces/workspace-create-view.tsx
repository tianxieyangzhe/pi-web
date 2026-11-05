import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Folder, FolderPlus, LoaderCircle, Trash2, X } from 'lucide-react';
import { workspaceApi } from '../../api/workspace-client';
import type { WorkspaceConfiguration, WorkspaceRecord } from '../../../src/domain/workspace';
import type { DirectoryListing } from '../../../src/application/ports/workspace';
function DirectoryPicker({ onSelect, onClose }: { onSelect: (path: string) => void; onClose: () => void }) {
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
      <button type="button" aria-label="关闭目录选择器" onClick={onClose}><X size={18}/></button>
    </header>
    <form className="mb-3 flex items-end gap-2" onSubmit={event => { event.preventDefault(); if (pathInput.trim() && !loading) navigate(pathInput.trim()); }}>
      <label className="min-w-0 flex-1 text-sm" htmlFor="workspace-directory-path">目录路径
        <input id="workspace-directory-path" type="text" value={pathInput} disabled={loading} autoComplete="off" spellCheck={false}
          placeholder="输入或粘贴绝对路径" onChange={event => setPathInput(event.target.value)}
          className="mt-2 block w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm outline-none focus:border-emerald-600 disabled:opacity-50"/>
      </label>
      <button type="submit" disabled={loading || !pathInput.trim()} className="rounded-md bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-40">跳转</button>
    </form>
    <div className="mb-3 flex items-center gap-2">
      <button type="button" disabled={!listing?.parent || loading} onClick={() => listing?.parent && navigate(listing.parent)} aria-label="上一级目录"><ArrowLeft size={16}/></button>
      <span className="min-w-0 break-all font-mono text-xs">{listing?.path ?? '正在读取目录…'}</span>
    </div>
    <div className="max-h-80 min-h-40 overflow-auto rounded-lg border border-slate-200">
      {loading ? <p className="p-3 text-sm" role="status">正在加载…</p> : !error && listing?.directories.map(entry =>
        <button key={entry.path} type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => navigate(entry.path)}><Folder size={15}/>{entry.name}</button>)}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    <footer className="mt-4 flex justify-end gap-2">
      <button type="button" className="rounded-md px-3 py-2 text-sm hover:bg-slate-100" onClick={onClose}>取消</button>
      <button type="button" className="rounded-md bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-40"
        disabled={!listing || loading || !!error || pathInput.trim() !== listing.path} onClick={() => listing && onSelect(listing.path)}>选择此目录</button>
    </footer>
  </dialog>;
}
export function WorkspaceCreateView({workspace,onSave,onClose}:{workspace?:WorkspaceRecord;onSave:(body:WorkspaceConfiguration,key:string)=>Promise<void>;onClose:()=>void}) {
  const [name,setName]=useState(workspace?.name??''),[projects,setProjects]=useState<Array<{id?:string;rootPath:string}>>(workspace?.projects.map(({id,rootPath})=>({id,rootPath}))??[]),[defaultIndex,setDefaultIndex]=useState(Math.max(0,workspace?.projects.findIndex(p=>p.id===workspace.defaultProjectId)??0)),[picker,setPicker]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const key=useRef(crypto.randomUUID());
  const changed=()=>{key.current=crypto.randomUUID();setError('');};
  async function save(){if(saving)return;setSaving(true);setError('');try{await onSave({name,projects,defaultProjectIndex:defaultIndex},key.current);}catch(cause){setError(cause instanceof Error?cause.message:'无法保存工作区');}finally{setSaving(false);}}
  function remove(index:number){changed();setProjects(items=>items.filter((_,i)=>i!==index));setDefaultIndex(current=>current===index?0:current>index?current-1:current);}
  return <main className="flex min-h-0 flex-1 flex-col overflow-auto bg-white p-5 sm:p-8"><header className="mb-6 flex items-start justify-between"><div><p className="text-xs text-slate-500">Workspace</p><h1 className="mt-1 text-xl font-semibold text-slate-800">{workspace?'工作区设置':'新建工作区'}</h1></div><button type="button" aria-label="关闭工作区新增页面" onClick={onClose}><X size={18}/></button></header><div className="w-full max-w-4xl"><label className="mb-6 block text-sm text-slate-700">工作区名称<input className="mt-2 block w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-emerald-600" value={name} maxLength={120} disabled={saving} onChange={event=>{changed();setName(event.target.value);}}/></label><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-medium">项目列表</h2><button type="button" className="flex items-center gap-1 rounded-md px-3 py-2 text-sm text-emerald-800 hover:bg-emerald-50" disabled={saving||projects.length>=32} onClick={()=>setPicker(true)}><FolderPlus size={16}/>添加项目目录</button></div><div className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3 font-medium">默认项目</th><th className="p-3 font-medium">项目名称</th><th className="p-3 font-medium">目录</th><th className="p-3"><span className="sr-only">操作</span></th></tr></thead><tbody>{projects.map((project,index)=><tr key={project.id??index} className="border-t border-slate-100"><td className="p-3"><input type="radio" name="workspace-default-project" aria-label={`设为默认项目：${project.rootPath}`} checked={index===defaultIndex} disabled={saving} onChange={()=>{changed();setDefaultIndex(index);}} className="accent-emerald-700"/></td><td className="p-3 font-medium text-slate-700">{project.rootPath.split(/[\\/]/).filter(Boolean).at(-1)??project.rootPath}</td><td className="max-w-lg break-all p-3 font-mono text-xs text-slate-500">{project.rootPath}</td><td className="p-3"><button type="button" aria-label={`移除 ${project.rootPath}`} disabled={saving} onClick={()=>remove(index)} className="text-slate-400 hover:text-red-700"><Trash2 size={15}/></button></td></tr>)}{!projects.length&&<tr><td colSpan={4} className="p-10 text-center text-sm text-slate-400">点击“添加项目目录”，在弹窗中输入路径或浏览目录，然后选择一个默认项目。</td></tr>}</tbody></table></div>{error&&<p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}<footer className="mt-6 flex justify-end gap-3"><button type="button" disabled={saving} className="rounded-md px-4 py-2 text-sm hover:bg-slate-100" onClick={onClose}>取消</button><button type="button" disabled={saving||!name.trim()||!projects.length} className="flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-40" onClick={()=>void save()}>{saving&&<LoaderCircle size={14} className="animate-spin"/>}{saving?'保存中…':'保存工作区'}</button></footer></div>{picker&&<DirectoryPicker onClose={()=>setPicker(false)} onSelect={rootPath=>{changed();setProjects(items=>[...items,{rootPath}]);setPicker(false);}}/>}</main>;
}
