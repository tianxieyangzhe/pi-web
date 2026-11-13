import {Button} from '../../components/button';
import { FileCodePreview } from './file-code-preview';
import { ErrorToast } from '../conversation/error-toast';
import { ChevronRight, FileCode2, Folder, GitCompare, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { FileEntry, FilePreview, ProjectChanges, ProjectFileListing } from "../../domain/models";

function parseGitChanges(status: string) {
  return status
    .split(/\r?\n/)
    .filter((line) => line.length >= 4)
    .map((line) => ({ path: line.slice(3), status: line.slice(0, 2).trim() || "modified" }));
}

export type FileBrowserApi={list:(path:string)=>Promise<ProjectFileListing>;read:(path:string)=>Promise<FilePreview>;changes?:()=>Promise<ProjectChanges>};
export function FileBrowser({ projectId, projectName, rootPath, onOpenFile, fileApi }: { projectId: string; projectName: string; rootPath: string; onOpenFile: (preview: FilePreview) => void; fileApi?:FileBrowserApi }) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isGitRepository, setIsGitRepository] = useState(false);
  const [gitUnavailable,setGitUnavailable]=useState(false),openVersion=useRef(0);
  const [truncated, setTruncated] = useState(false);
  const [changes, setChanges] = useState<ProjectChanges | null>(null);
  const [changesError, setChangesError] = useState("");
  const [showDiff, setShowDiff] = useState(false), [diffLoading, setDiffLoading] = useState(false);
  const diffVersion = useRef(0), diffPending = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setEntries([]);
    setIsGitRepository(false);setGitUnavailable(false);
    setTruncated(false);
    setChanges(null);
    setChangesError("");
    setShowDiff(false); setDiffLoading(false); diffPending.current = false; diffVersion.current++;

    async function load() {
      try {
        const listing = await (fileApi?fileApi.list(path):api.listFiles(projectId, path));
        if (!active) return;
        setEntries(listing.entries);
        setIsGitRepository(listing.isGitRepository);setGitUnavailable(listing.gitState==='unavailable');
        setTruncated(listing.truncated);
        setLoading(false);

      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "无法读取项目文件");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => { active = false;openVersion.current++;diffVersion.current++; };
  }, [path, projectId, fileApi]);

  async function open(entry: FileEntry) {
    if (entry.type === "directory") {
      openVersion.current++;
      setPath(entry.path);
      return;
    }
    const version=++openVersion.current;
    try {
      setError("");const preview=await (fileApi?fileApi.read(entry.path):api.readFile(projectId, entry.path));
      if(version===openVersion.current)onOpenFile(preview);
    } catch (cause) {
      if(version===openVersion.current)setError(cause instanceof Error ? cause.message : "无法读取文件");
    }
  }

  const diffDisabled = loading || !isGitRepository || gitUnavailable || !!fileApi && !fileApi.changes;
  const diffReason = loading ? '正在检查 Git 状态' : gitUnavailable ? 'Git 命令或仓库状态不可用' : !isGitRepository ? '项目不属于 Git 仓库' : fileApi && !fileApi.changes ? '当前入口未提供 Git diff API' : '查看工作区与暂存区的 Git diff';
  async function loadDiff() {
    if (diffDisabled || diffPending.current) return;
    const version = ++diffVersion.current;
    diffPending.current = true; setShowDiff(true); setDiffLoading(true); setChangesError('');
    try {
      const value = await (fileApi?.changes ? fileApi.changes() : api.listChanges(projectId));
      if (version === diffVersion.current) setChanges(value);
    } catch (cause) {
      if (version === diffVersion.current) setChangesError(cause instanceof Error ? cause.message : '无法读取 Git diff');
    } finally {
      if (version === diffVersion.current) { diffPending.current = false; setDiffLoading(false); }
    }
  }
  function closeDiff() { diffVersion.current++; diffPending.current = false; setShowDiff(false); setDiffLoading(false); setChangesError(''); }
  const changedFiles = changes?.isGitRepository ? parseGitChanges(changes.status) : [];
  const normalizedRootPath = rootPath.replace(/[\\/]+$/, "");
  const separator = rootPath.includes("\\") ? "\\" : "/";
  const absolutePath = path
    ? `${normalizedRootPath || separator}${normalizedRootPath ? separator : ""}${path.split(/[\\/]/).join(separator)}`
    : rootPath;

  return (
    <div className="file-panel">
      <header><b className="min-w-0 truncate">{projectName} · 项目文件</b><Button type="button" title={diffReason} disabled={diffDisabled || diffLoading} aria-pressed={showDiff} onClick={() => showDiff ? closeDiff() : void loadDiff()}><GitCompare size={14}/>diff</Button></header>
      <div className="file-panel__toolbar">
        <Button onClick={() => setPath("")} disabled={!path}>项目根目录</Button>
        <span className="file-panel__absolute-path" title={absolutePath}>{absolutePath}</span>
      </div>
      <div className="file-panel__body">
        {showDiff ? <section aria-label="Git diff" className="space-y-3">
          <div className="flex items-center justify-between gap-2"><Button type="button" onClick={closeDiff}>返回文件</Button><Button type="button" disabled={diffLoading || diffDisabled} onClick={() => void loadDiff()}>{diffLoading ? '正在读取…' : '刷新'}</Button></div>
          <ErrorToast message={changesError} onDismiss={() => setChangesError('')} onRetry={() => void loadDiff()}/>
          {diffLoading && <p role="status" className="text-xs text-slate-500">正在读取 Git diff…</p>}
          {changes && <>
            {!changes.isGitRepository ? <p className="file-empty">项目当前不属于 Git 仓库。</p> : <>
              {changes.truncated && <p className="text-xs text-amber-700">Git 差异超过容量上限，当前内容已截断。</p>}
              {changedFiles.length > 0 && <details><summary className="cursor-pointer text-xs text-slate-600">文件状态 · {changedFiles.length}</summary><pre className="overflow-x-auto text-xs">{changes.status}</pre></details>}
              <p className="text-xs text-slate-500">未跟踪文件只显示状态，不包含在 Git diff 中。</p>
              {([['工作区 · git diff', changes.workingPatch], ['暂存区 · git diff --cached', changes.stagedPatch]] as const).map(([title, patch]) => <section key={title}><h3 className="mb-2 text-xs font-semibold text-slate-700">{title}</h3>{patch ? <pre aria-label={title} className="m-0 overflow-x-auto font-mono text-xs leading-5">{patch.split('\n').map((text, index) => <span key={index} className={`block min-h-5 ${text.startsWith('+') ? 'bg-emerald-50 text-emerald-800' : text.startsWith('-') ? 'bg-red-50 text-red-800' : text.startsWith('@@') ? 'text-blue-700' : 'text-slate-600'}`}>{text || ' '}</span>)}</pre> : <p className="file-empty">{changes.truncated ? '此部分无可显示的差异，输出已截断。' : '没有已跟踪文件差异。'}</p>}</section>)}
            </>}
          </>}
        </section> : <>
        {loading && <LoaderCircle className="spin" size={15} />}
        {!loading && !error && entries.length === 0 && <p className="file-empty">此目录为空</p>}
        {entries.map((entry) => (
          <Button variant="ghost" size="row" className="file-entry" key={entry.path} onClick={() => void open(entry)}>
            {entry.type === "directory" ? <Folder size={14} /> : <FileCode2 size={14} />}
            <span>{entry.name}</span>
            {entry.type === "directory" && <ChevronRight size={13} />}
            {entry.gitStatus && <small>{entry.gitStatus}</small>}
          </Button>
        ))}
        {truncated && <p className="file-empty">此目录内容较多，仅显示排序后的前 2000 项。</p>}
        {gitUnavailable&&<p className="file-empty">Git 状态暂不可用，仍可浏览目录和文件。</p>}
        </>}
      </div>
      <ErrorToast message={error} onDismiss={()=>setError('')}/>
    </div>
  );
}

export function FilePreviewPane({ projectName, rootPath, preview, line, onClose, onDownload, loadPdf, onSetReference, referenceDisabled=false, referenced=false }: { projectName: string; rootPath: string; preview: FilePreview; line?: number; onClose: () => void; onDownload: () => Promise<void>; loadPdf: (signal: AbortSignal) => Promise<Blob>; onSetReference?:()=>Promise<void>; referenceDisabled?:boolean; referenced?:boolean }) {
  const [pdf,setPdf]=useState<{preview:FilePreview;url?:string;error?:string}|null>(null);
  const pdfLoader=useRef(loadPdf);pdfLoader.current=loadPdf;
  useEffect(()=>{
    if(preview.format!=='pdf'){setPdf(null);return;}
    let active=true,url:string|undefined;const controller=new AbortController();
    setPdf({preview});
    void pdfLoader.current(controller.signal).then(async blob=>{
      if(blob.type!=='application/pdf'||!(await blob.slice(0,1024).text()).includes('%PDF-'))throw new Error('PDF文件已变化或格式无效，请重新打开');
      if(!active)return;
      url=URL.createObjectURL(blob);setPdf({preview,url});
    }).catch(error=>{if(active)setPdf({preview,error:error instanceof Error?error.message:'PDF预览加载失败'});});
    return()=>{active=false;controller.abort();if(url)URL.revokeObjectURL(url);};
  },[preview]);
  const [settingReference,setSettingReference]=useState(false),[referenceError,setReferenceError]=useState('');
  const referenceVersion=useRef(0),referenceLock=useRef(false);
  useEffect(()=>{referenceVersion.current++;referenceLock.current=false;setSettingReference(false);setReferenceError('');return()=>{referenceVersion.current++;};},[preview]);
  async function setReference(){
    if(!onSetReference||referenceDisabled||referenced||referenceLock.current)return;
    const version=referenceVersion.current;referenceLock.current=true;setSettingReference(true);setReferenceError('');
    try{await onSetReference();}catch(error){if(version===referenceVersion.current)setReferenceError(error instanceof Error?error.message:'参考文件设置失败');}
    finally{if(version===referenceVersion.current){referenceLock.current=false;setSettingReference(false);}}
  }
  const [downloading,setDownloading]=useState(false),[downloadError,setDownloadError]=useState('');
  const downloadVersion=useRef(0);
  useEffect(()=>{downloadVersion.current++;setDownloading(false);setDownloadError('');return()=>{downloadVersion.current++;};},[preview]);
  async function download(){const version=++downloadVersion.current;setDownloading(true);setDownloadError('');try{await onDownload();}catch(error){if(version===downloadVersion.current)setDownloadError(error instanceof Error?error.message:'下载失败');}finally{if(version===downloadVersion.current)setDownloading(false);}}
  const normalizedRootPath = rootPath.replace(/[\\/]+$/, "");
  const separator = rootPath.includes("\\") ? "\\" : "/";
  const absolutePath = rootPath ? `${normalizedRootPath || separator}${normalizedRootPath ? separator : ""}${preview.path.split(/[\\/]/).join(separator)}` : preview.path;

  return (
    <aside className="file-preview-column" aria-label="文件预览">
      <header className="file-preview-column__header">
        <Button className="file-preview-column__download" disabled={downloading} onClick={()=>void download()}>{downloading?'正在下载…':'下载原件'}</Button>
        {onSetReference&&<Button type="button" disabled={settingReference||referenceDisabled||referenced} onClick={()=>void setReference()}>{settingReference?'正在设置…':referenced?'已设为参考文件':'设置参考文件'}</Button>}
        <b>{projectName} · 文件预览</b>
        <Button variant="ghost" size="icon" aria-label="关闭文件预览" onClick={onClose}><X size={15} /></Button>
      </header>
      <div className="file-preview-column__path" title={absolutePath}>{absolutePath}</div>
      <ErrorToast message={downloadError} onDismiss={()=>setDownloadError('')}/>
      <ErrorToast message={referenceError} onDismiss={()=>setReferenceError('')}/>
      <ErrorToast message={preview.notice}/>
      {preview.format==='pdf'?<div className="flex min-h-0 flex-1 flex-col px-3 pb-3">{pdf?.preview===preview&&pdf.error?<ErrorToast message={`${pdf.error}，可下载原件查看。`}/>:pdf?.preview===preview&&pdf.url?<iframe title={`${preview.path} · PDF预览`} src={pdf.url} className="min-h-80 w-full flex-1 border-0"/>:<p role="status" className="text-sm text-slate-500">正在加载PDF…</p>}</div>:['docx','xlsx','pptx'].includes(preview.format??'')?<div className="min-h-0 flex-1 overflow-auto p-4 text-sm text-slate-800">{preview.blocks?.map((block,index)=>block.type==='table'?<div key={index} className="my-3 overflow-auto"><table className="w-full border-collapse"><tbody>{block.rows.map((row,r)=><tr key={r}>{row.map((cell,c)=><td key={c} className="whitespace-pre-wrap border border-slate-300 p-2 align-top">{cell}</td>)}</tr>)}</tbody></table></div>:block.type==='heading'?<div key={index} role="heading" aria-level={block.level} className={`mb-2 mt-4 font-semibold ${block.level===1?'text-xl':block.level===2?'text-lg':'text-base'}`}>{block.text}</div>:block.type==='code'?<pre key={index} className="my-2 overflow-auto rounded bg-slate-100 p-3 font-mono text-xs whitespace-pre"><code>{block.text}</code></pre>:<p key={index} className="my-2 whitespace-pre-wrap">{block.text||'\u00a0'}</p>)}</div>:preview.format!=='binary'&&<FileCodePreview path={preview.path} content={preview.content} line={line}/>}
    </aside>
  );
}
