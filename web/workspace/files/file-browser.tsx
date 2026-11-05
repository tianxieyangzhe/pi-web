import { ChevronRight, FileCode2, Folder, GitCompare, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { FileEntry, FilePreview, ProjectChanges } from "../../domain/models";

function parseGitChanges(status: string) {
  return status
    .split(/\r?\n/)
    .filter((line) => line.length >= 4)
    .map((line) => ({ path: line.slice(3), status: line.slice(0, 2).trim() || "modified" }));
}

export function FileBrowser({ projectId, projectName, rootPath, onOpenFile }: { projectId: string; projectName: string; rootPath: string; onOpenFile: (preview: FilePreview) => void }) {
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
        const listing = await api.listFiles(projectId, path);
        if (!active) return;
        setEntries(listing.entries);
        setIsGitRepository(listing.isGitRepository);setGitUnavailable(listing.gitState==='unavailable');
        setTruncated(listing.truncated);
        setLoading(false);

        if (listing.isGitRepository) {
          try {
            const nextChanges = await api.listChanges(projectId);
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
  }, [path, projectId]);

  async function open(entry: FileEntry) {
    if (entry.type === "directory") {
      openVersion.current++;
      setPath(entry.path);
      return;
    }
    const version=++openVersion.current;
    try {
      setError("");const preview=await api.readFile(projectId, entry.path);
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
        <button onClick={() => setPath("")} disabled={!path}>项目根目录</button>
        <span className="file-panel__absolute-path" title={absolutePath}>{absolutePath}</span>
      </div>
      <div className="file-panel__body">
        {loading && <LoaderCircle className="spin" size={15} />}
        {!loading && !error && entries.length === 0 && <p className="file-empty">此目录为空</p>}
        {entries.map((entry) => (
          <button className="file-entry" key={entry.path} onClick={() => void open(entry)}>
            {entry.type === "directory" ? <Folder size={14} /> : <FileCode2 size={14} />}
            <span>{entry.name}</span>
            {entry.type === "directory" && <ChevronRight size={13} />}
            {entry.gitStatus && <small>{entry.gitStatus}</small>}
          </button>
        ))}
        {truncated && <p className="file-empty">此目录内容较多，仅显示排序后的前 2000 项。</p>}
        {gitUnavailable&&<p className="file-empty">Git 状态暂不可用，仍可浏览目录和文件。</p>}
        {isGitRepository && (
          <details className="changes">
            <summary><GitCompare size={13} />变更 {changedFiles.length}</summary>
            {changesError && <p className="file-empty">Git 变更暂不可用：{changesError}</p>}
            {changes?.truncated&&<p className="file-empty">变更内容超过容量上限，当前展示已截断。</p>}
            {changedFiles.map((change) => <div key={change.path}>{change.path}<small>{change.status}</small></div>)}
          </details>
        )}
      </div>
      {error && <button className="file-error" onClick={() => setError("")}>{error}</button>}
    </div>
  );
}

export function FilePreviewPane({ projectName, rootPath, preview, line, onClose }: { projectName: string; rootPath: string; preview: FilePreview; line?: number; onClose: () => void }) {
  const contentRef=useRef<HTMLPreElement>(null);
  const lines=line?preview.content.split('\n'):[];
  useEffect(()=>{if(line)contentRef.current?.querySelector(`[data-line="${line}"]`)?.scrollIntoView?.({block:'center'});},[preview,line]);
  const normalizedRootPath = rootPath.replace(/[\\/]+$/, "");
  const separator = rootPath.includes("\\") ? "\\" : "/";
  const absolutePath = `${normalizedRootPath || separator}${normalizedRootPath ? separator : ""}${preview.path.split(/[\\/]/).join(separator)}`;

  return (
    <aside className="file-preview-column" aria-label="文件预览">
      <header className="file-preview-column__header">
        <b>{projectName} · 文件预览</b>
        <button aria-label="关闭文件预览" onClick={onClose}><X size={15} /></button>
      </header>
      <div className="file-preview-column__path" title={absolutePath}>{absolutePath}</div>
      <pre ref={contentRef} className="file-preview-column__content">{line?lines.map((text,index)=><span className={index+1===line?'bg-amber-100':''} data-line={index+1} key={index}>{text}{index<lines.length-1?'\n':''}</span>):preview.content}</pre>
    </aside>
  );
}
