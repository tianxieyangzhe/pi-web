import { useState } from "react";
import type { Project } from "../../domain/models";

export function ProjectForm({ project, onSave, onDelete }: {
  project: Project | null;
  onSave: (body: Record<string, unknown>) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [rootPath, setRootPath] = useState(project?.rootPath ?? "");
  const [status, setStatus] = useState<"active" | "disabled" | "archived">(project?.status ?? "active");

  return <div className="inspector__body">
    <label>名称<input value={name} onChange={(event) => setName(event.target.value)} /></label>
    <label>说明<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <label>目录绝对路径<input value={rootPath} onChange={(event) => setRootPath(event.target.value)} placeholder="/path/to/project" /></label>
    <label>状态<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
      <option value="active">进行中</option>
      <option value="disabled">已停用</option>
      <option value="archived">已归档</option>
    </select></label>
    <div className="form-actions">
      <button className="primary" onClick={() => onSave({ name, description, rootPath, kind: "code", status })}>保存</button>
      {onDelete && <button className="danger" onClick={onDelete}>删除</button>}
    </div>
  </div>;
}
