import { ArrowRight, FolderKanban, Plus, X } from "lucide-react";
import type { Project } from "../../domain/models";

export function ProjectSessionCreatePanel({
  projects,
  creatingProjectId,
  onClose,
  onSelectProject,
  onCreateProject,
}: {
  projects: Project[];
  creatingProjectId: string | null;
  onClose: () => void;
  onSelectProject: (projectId: string) => void;
  onCreateProject: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <section className="modal project-session-create" role="dialog" aria-modal="true" aria-labelledby="project-session-create-title">
        <header>
          <div>
            <h2 id="project-session-create-title">新建项目会话</h2>
            <p className="modal__description">选择一个项目，创建并进入一条新的项目工作线。</p>
          </div>
          <button aria-label="关闭新建项目会话" onClick={onClose}><X size={16} /></button>
        </header>
        {projects.length > 0 ? (
          <div className="project-session-picker" aria-label="选择项目">
            {projects.map((project) => {
              const creating = creatingProjectId === project.id;
              return (
                <button
                  className="project-session-picker__option"
                  key={project.id}
                  type="button"
                  disabled={creatingProjectId !== null}
                  onClick={() => onSelectProject(project.id)}
                >
                  <FolderKanban size={16} aria-hidden="true" />
                  <span className="project-session-picker__name">{project.name}</span>
                  <span className="project-session-picker__action">{creating ? "创建中…" : "新建并进入"}<ArrowRight size={14} aria-hidden="true" /></span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="project-session-create__empty">
            <p>还没有可用项目。先创建一个项目，再新建项目会话。</p>
            <button className="primary" type="button" onClick={onCreateProject}><Plus size={14} />新建项目</button>
          </div>
        )}
        <footer><button type="button" onClick={onClose}>取消</button></footer>
      </section>
    </div>
  );
}
