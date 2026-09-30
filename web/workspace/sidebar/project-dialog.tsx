import { X } from "lucide-react";
import { useState } from "react";
import type { Project } from "../../domain/models";
import { ProjectForm } from "./project-form";

export function ProjectDialog({ project, open, onClose, onSave, onDelete }: {
  project: Project | null;
  open: boolean;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  function close() { setConfirmDelete(false); onClose(); }
  if (!open) return null;

  return <>
    <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="modal resource-modal" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title" onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
        <header>
          <div><span className="eyebrow">Project</span><h2 id="project-dialog-title">{project ? "项目设置" : "新建项目"}</h2></div>
          <button aria-label="关闭项目弹窗" onClick={close}><X size={16} /></button>
        </header>
        <ProjectForm
          key={project?.id ?? "new-project"}
          project={project}
          onSave={(body) => { onSave(body); close(); }}
          onDelete={project ? () => setConfirmDelete(true) : undefined}
        />
      </section>
    </div>
    {confirmDelete && project && <div className="modal-backdrop modal-backdrop--nested">
      <section className="modal" role="alertdialog" aria-modal="true" aria-labelledby="project-delete-title">
        <header><h2 id="project-delete-title">删除项目？</h2><button aria-label="关闭确认弹窗" onClick={() => setConfirmDelete(false)}><X size={16} /></button></header>
        <p className="modal__description">确定删除“{project.name}”吗？如果项目仍被会话或任务引用，系统会阻止删除。</p>
        <footer>
          <button onClick={() => setConfirmDelete(false)}>取消</button>
          <button className="danger" onClick={() => { onDelete(project.id); close(); }}>删除项目</button>
        </footer>
      </section>
    </div>}
  </>;
}
