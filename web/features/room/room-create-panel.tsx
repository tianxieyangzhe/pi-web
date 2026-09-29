import { useState } from "react";
import type { Project } from "../../domain/models";
export function RoomCreatePanel({ projects, onClose, onCreate }: { projects: Project[]; onClose: () => void; onCreate: (projectIds: string[], title: string) => void }) {
  const [selected, setSelected] = useState<string[]>([]); const [title, setTitle] = useState("");
  function toggle(id: string) { setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  return <div className="modal-backdrop"><section className="modal"><header><h2>新建跨项目会话</h2><button onClick={onClose}>关闭</button></header><label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="可留空自动生成" /></label><div className="check-list">{projects.filter((item) => item.status === "active").map((project) => <label key={project.id}><input type="checkbox" checked={selected.includes(project.id)} onChange={() => toggle(project.id)} />{project.name}</label>)}</div><footer><button onClick={onClose}>取消</button><button className="primary" disabled={selected.length < 2} onClick={() => onCreate(selected, title)}>创建</button></footer></section></div>;
}
