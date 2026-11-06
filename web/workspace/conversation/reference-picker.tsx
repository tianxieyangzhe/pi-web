import { Folder, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { FileEntry, Project } from "../../domain/models";
import type { ProjectMessageReference } from "../../../src/domain/message-references";
import { validateAttachments } from "./clipboard";
import { ErrorToast } from "./error-toast";
type DirectoryReference = ProjectMessageReference;
function sameReference(left: DirectoryReference, right: DirectoryReference) {
  return left.path === right.path && left.projectId === right.projectId;
}

export function ReferencePicker({ selected, onChange, disabled, projectCount = 0 }: { selected: File[]; onChange: (files: File[]) => void; disabled?: boolean; projectCount?: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  function add(files: FileList | null) {
    if (!files?.length) return;
    const next = [...selected, ...Array.from(files)];
    try { validateAttachments(next, projectCount); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "文件不可用"); return; }
    setError(""); onChange(next);
  }
  return <div className="reference-picker">
    <input ref={input} type="file" multiple hidden disabled={disabled} onChange={event => { add(event.target.files); event.target.value = ""; }} />
    <button type="button" className="reference-picker__trigger" title="点击上传或将文件拖入输入框；文件保存后供模型按需读取，图片直接识别" disabled={disabled} onClick={() => input.current?.click()}><Paperclip size={15}/> 上传文件</button>
    <ErrorToast message={error} onDismiss={() => setError("")} />
  </div>;
}

export function ProjectReferencePicker({ projects, selected, onChange, disabled, uploadCount, onDone, listFiles }: { projects: Project[]; selected: DirectoryReference[]; onChange: (references: DirectoryReference[]) => void; disabled?: boolean; uploadCount: number; onDone?: () => void; listFiles?:(projectId:string,path:string)=>Promise<import('../../domain/models').ProjectFileListing> }) {
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [open]);
  useEffect(() => {
    if (!open || !projectId) return;
    let live = true;
    setEntries([]); setError(""); setTruncated(false);
    const listing = (listFiles??api.listFiles)(projectId.slice(8), path);
    listing.then(result => { if (live) { setEntries(result.entries); setTruncated(result.truncated); } }).catch(cause => { if (live) setError(cause instanceof Error ? cause.message : "无法读取目录"); });
    return () => { live = false; };
  }, [open, projectId, path, listFiles]);
  function toggle(item: DirectoryReference) {
    const exists = selected.some(value => sameReference(value, item));
    if (!exists && selected.length + uploadCount >= 10) { setError("最多选择 10 个参考文件"); return; }
    setError(""); onChange(exists ? selected.filter(value => !sameReference(value, item)) : [...selected, item]);
  }
  return <div className="reference-picker">
    <button type="button" className="reference-picker__trigger" title="提供项目文件位置，由模型按需读取最新内容" disabled={disabled || !projects.length} onClick={() => { setProjectId(projects[0] ? `project:${projects[0].id}` : ""); setPath(""); setError(""); setOpen(true); }}><Folder size={15}/> 参考项目文件</button>
    {open && <dialog ref={dialog} className="reference-picker__dialog" aria-label="参考项目文件" onClose={() => { setOpen(false); onDone?.(); }}>
      <header><b>参考项目文件</b><button type="button" aria-label="关闭" onClick={() => dialog.current?.close()}><X size={16}/></button></header>
      <div className="reference-picker__projects">{projects.map(project => <button type="button" key={project.id} aria-pressed={projectId === `project:${project.id}`} onClick={() => { setProjectId(`project:${project.id}`); setPath(""); }}>{project.name}</button>)}</div>
      <div className="reference-picker__path"><span>{path || "项目根目录"}</span>{path && <button type="button" onClick={() => setPath(path.split(/[\\/]/).slice(0,-1).join("/"))}>上一级</button>}</div>
      <div className="reference-picker__entries">{entries.map(entry => { const reference: DirectoryReference = {projectId:projectId.slice(8),path:entry.path}; return entry.type === "directory" ? <button type="button" key={entry.path} onClick={() => setPath(entry.path)}><Folder size={14}/> {entry.name} /</button> : <label key={entry.path}><input type="checkbox" checked={selected.some(item => sameReference(item, reference))} onChange={() => toggle(reference)}/>{entry.name}</label>; })}{truncated && <p>仅显示前 1000 项</p>}</div>
      {error && <p role="alert">{error}</p>}
      <footer><span>已选 {selected.length} 个项目文件</span><button type="button" onClick={() => dialog.current?.close()}>完成</button></footer>
    </dialog>}
  </div>;
}

export function readReference(file: File): Promise<{name: string; data: string}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取上传文件，请重新选择"));
    reader.onabort = () => reject(new Error("读取上传文件已取消"));
    reader.onload = () => {
      if (typeof reader.result !== "string" || !reader.result.includes(",")) { reject(new Error("无法读取上传文件")); return; }
      resolve({name: file.name, data: reader.result.slice(reader.result.indexOf(",") + 1)});
    };
    reader.readAsDataURL(file);
  });
}
