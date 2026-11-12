import {Button} from '../../components/button';
import { useMemo, useState } from "react";
import type { Agent, Mcp } from "../../domain/models";

type Resource = Agent | Mcp | null | undefined;
export function AgentMcpForm({ resource, onSave, onDelete }: { resource: Resource; onSave: (body: Record<string, unknown>) => void; onDelete?: () => void }) {
  const initial = useMemo(() => ({ name: resource?.name ?? "", description: resource?.description ?? "" }), [resource]);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [status, setStatus] = useState<"active" | "disabled" | "archived">(resource?.status ?? "active");
  function save() { onSave({ name, description, status }); }
  return <div className="inspector__body"><label>名称<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>说明<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label><label>状态<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="active">进行中</option><option value="disabled">已停用</option><option value="archived">已归档</option></select></label><div className="form-actions"><Button variant="primary"  onClick={save}>保存</Button>{onDelete && <Button variant="danger"  onClick={onDelete}>删除</Button>}</div></div>;
}
