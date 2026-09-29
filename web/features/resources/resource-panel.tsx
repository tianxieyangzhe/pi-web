import { useMemo, useState } from "react";
import type { Agent, Mcp, Project } from "../../domain/models";

type Kind = "project" | "agent" | "mcp";
type Resource = Project | Agent | Mcp | null | undefined;
export function ResourcePanel({ kind, resource, onSave, onDelete }: { kind: Kind; resource: Resource; onClose?: () => void; onSave: (body: Record<string, unknown>) => void; onDelete?: () => void }) {
  const initial = useMemo(() => ({ name: resource?.name ?? "", description: resource?.description ?? "" }), [resource]);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [rootPath, setRootPath] = useState((resource as Project | null)?.rootPath ?? "");
  const [status, setStatus] = useState<"active" | "disabled" | "archived">((resource as Project | null)?.status ?? "active");
  function save() { onSave(kind === "project" ? { name, description, rootPath, kind: "code", status } : { name, description, status }); }
  return <div className="inspector__body"><label>名称<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>说明<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>{kind === "project" && <label>目录绝对路径<input value={rootPath} onChange={(event) => setRootPath(event.target.value)} placeholder="/path/to/project" /></label>}<label>状态<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="active">进行中</option><option value="disabled">已停用</option><option value="archived">已归档</option></select></label><div className="form-actions"><button className="primary" onClick={save}>保存</button>{onDelete && <button className="danger" onClick={onDelete}>删除</button>}</div></div>;
}
