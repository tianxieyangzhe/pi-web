import {Button} from '../../components/button';
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

    async function load() {
      try {
        const listing = await (fileApi?fileApi.list(path):api.listFiles(projectId, path));
        if (!active) return;
        setEntries(listing.entries);
        setIsGitRepository(listing.isGitRepository);setGitUnavailable(listing.gitState==='unavailable');
        setTruncated(listing.truncated);
        setLoading(false);

        if (listing.isGitRepository&&(!fileApi||fileApi.changes)) {
          try {
            const nextChanges = await (fileApi?.changes?fileApi.changes():api.listChanges(projectId));
            if (active) setChanges(nextChanges);
          } catch (cause) {
            if (active) setChangesError(cause instanceof Error ? cause.message : "无法读取 Git 变更");
          }
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "无法读取项目文件");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => { active = false;openVersion.current++; };
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

  const changedFiles = changes?.isGitRepository ? parseGitChanges(changes.status) : [];
  const normalizedRootPath = rootPath.replace(/[\\/]+$/, "");
  const separator = rootPath.includes("\\") ? "\\" : "/";
  const absolutePath = path
    ? `${normalizedRootPath || separator}${normalizedRootPath ? separator : ""}${path.split(/[\\/]/).join(separator)}`
    : rootPath;

  return (
    <div className="file-panel">
      <header><b>{projectName} · 项目文件</b></header>
      <div className="file-panel__toolbar">
        <Button onClick={() => setPath("")} disabled={!path}>项目根目录</Button>
        <span className="file-panel__absolute-path" title={absolutePath}>{absolutePath}</span>
      </div>
      <div className="file-panel__body">
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
        {isGitRepository && (!fileApi||fileApi.changes) && (
          <details className="changes">
            <summary><GitCompare size={13} />变更 {changedFiles.length}</summary>
            {changesError && <p className="file-empty">Git 变更暂不可用：{changesError}</p>}
            {changes?.truncated&&<p className="file-empty">变更内容超过容量上限，当前展示已截断。</p>}
            {changedFiles.map((change) => <div key={change.path}>{change.path}<small>{change.status}</small></div>)}
          </details>
        )}
      </div>
      {error && <Button variant="danger" size="row" className="file-error" onClick={() => setError("")}>{error}</Button>}
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
  const contentRef=useRef<HTMLPreElement>(null);
  const lines=line?preview.content.split('\n'):[];
  useEffect(()=>{if(line)contentRef.current?.querySelector(`[data-line="${line}"]`)?.scrollIntoView?.({block:'center'});},[preview,line]);
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
      {downloadError&&<p role="alert" className="px-3 text-sm text-red-700">{downloadError}</p>}
      {referenceError&&<p role="alert" className="px-3 text-sm text-red-700">{referenceError}</p>}
      {preview.notice&&<p className="px-3 text-xs text-slate-500">{preview.notice}</p>}
      {preview.format==='pdf'?<div className="flex min-h-0 flex-1 flex-col px-3 pb-3">{pdf?.preview===preview&&pdf.error?<p role="alert" className="text-sm text-red-700">{pdf.error}，可下载原件查看。</p>:pdf?.preview===preview&&pdf.url?<iframe title={`${preview.path} · PDF预览`} src={pdf.url} className="min-h-80 w-full flex-1 border-0"/>:<p role="status" className="text-sm text-slate-500">正在加载PDF…</p>}</div>:['docx','xlsx','pptx'].includes(preview.format??'')?<div className="min-h-0 flex-1 overflow-auto p-4 text-sm text-slate-800">{preview.blocks?.map((block,index)=>block.type==='table'?<div key={index} className="my-3 overflow-auto"><table className="w-full border-collapse"><tbody>{block.rows.map((row,r)=><tr key={r}>{row.map((cell,c)=><td key={c} className="whitespace-pre-wrap border border-slate-300 p-2 align-top">{cell}</td>)}</tr>)}</tbody></table></div>:block.type==='heading'?<div key={index} role="heading" aria-level={block.level} className={`mb-2 mt-4 font-semibold ${block.level===1?'text-xl':block.level===2?'text-lg':'text-base'}`}>{block.text}</div>:block.type==='code'?<pre key={index} className="my-2 overflow-auto rounded bg-slate-100 p-3 font-mono text-xs whitespace-pre"><code>{block.text}</code></pre>:<p key={index} className="my-2 whitespace-pre-wrap">{block.text||'\u00a0'}</p>)}</div>:preview.format!=='binary'&&<pre ref={contentRef} className="file-preview-column__content">{line?lines.map((text,index)=><span className={index+1===line?'bg-amber-100':''} data-line={index+1} key={index}>{text}{index<lines.length-1?'\n':''}</span>):preview.content}</pre>}
    </aside>
  );
}
