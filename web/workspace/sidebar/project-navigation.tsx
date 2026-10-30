import {isSelected,type WorkspaceSelection} from "./workspace-selection";
import { ChevronDown, ChevronRight, FolderKanban, Plus, Settings2, Sparkles } from "lucide-react";
import type { Project } from "../../domain/models";
import { useProjectSessionNavigation } from "./use-project-session-navigation";

type ResourceKind = "agent" | "mcp";

export function ProjectNavigation({ projects, selection, navigation, creatingSessionProjectId, onNewProject, onOpenTemplates, onNewProjectSession, botNavigation, onCreateSession, onProjectSelect, onSessionSelect, onEditProject, onOpenResource }: {
  projects: Project[];
  selection:WorkspaceSelection|null;
  navigation: ReturnType<typeof useProjectSessionNavigation>;
  creatingSessionProjectId: string | null;
  onNewProject: () => void;
  onOpenTemplates:()=>void;
  onNewProjectSession: () => void;
  botNavigation: import("react").ReactNode;
  onCreateSession: (projectId: string) => void;
  onProjectSelect: (projectId: string) => void;
  onSessionSelect: (projectId: string, sessionId: string) => void;
  onEditProject: (projectId: string) => void;
  onOpenResource: (kind: ResourceKind) => void;
}) {
  return (
      <aside className="sidebar" id="project-navigation">
        <div className="sidebar__actions">
          <button onClick={() => onNewProjectSession()}><Plus size={14} />新建项目会话</button>

          <button onClick={onOpenTemplates}><Sparkles size={14}/>记忆模板库</button>
        </div>
        <nav className="sidebar__nav" aria-label="项目导航">
          {botNavigation}
          <div className="sidebar__label project-navigation__section-heading"><span>项目</span><button className="nav-icon" type="button" aria-label="新建项目" title="新建项目" onClick={onNewProject}><Plus size={14}/></button></div>
          {projects.map((project) => (
            <div className="project-nav-entry" key={project.id}>
              <div className="nav-row">
                <button
                  className={`project-link${isSelected(selection,"project",project.id) ? " active" : ""}`}
                  aria-expanded={navigation.expandedProjectIds.has(project.id)}
                  aria-current={isSelected(selection,"project",project.id)?"page":undefined}
                  onClick={() => {
                    navigation.toggleProject(project.id);
                    onProjectSelect(project.id);
                  }}
                >
                  <FolderKanban size={15} /><span>{project.name}</span>
                </button>
                <button
                  className="nav-icon"
                  aria-label={`新建 ${project.name} 的项目会话`}
                  title={`新建 ${project.name} 的项目会话`}
                  disabled={project.status !== "active" || creatingSessionProjectId !== null}
                  onClick={() => void onCreateSession(project.id)}
                >
                  <Plus size={13} />
                </button>
                <button
                  className="project-session-toggle"
                  aria-label={`${navigation.expandedProjectIds.has(project.id) ? "收起" : "展开"}${project.name}的会话记录`}
                  aria-expanded={navigation.expandedProjectIds.has(project.id)}
                  onClick={() => navigation.toggleProject(project.id)}
                >
                  {navigation.expandedProjectIds.has(project.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <button className="nav-icon" aria-label={`编辑 ${project.name}`} onClick={() => onEditProject(project.id)}>
                  <Settings2 size={13} />
                </button>
              </div>
              {navigation.expandedProjectIds.has(project.id) && (
                <div className="project-sessions" aria-label={`${project.name}的会话记录`}>
                  {navigation.loadingProjectIds.has(project.id) && <div className="project-sessions__message" role="status">正在加载会话记录…</div>}
                  {navigation.errorsByProject[project.id] && <button className="project-sessions__message project-sessions__message--error" onClick={() => void navigation.loadProjectSessions(project.id, true)}>加载失败，点击重试</button>}
                  {!navigation.loadingProjectIds.has(project.id) && !navigation.errorsByProject[project.id] && (navigation.sessionsByProject[project.id] ?? []).filter(session=>!session.botParent).length === 0 && <div className="project-sessions__message">暂无独立会话记录</div>}
                  {([...(navigation.sessionsByProject[project.id] ?? []).filter(session=>!session.botParent)]).reverse().map((session) => {
                    const summary = session.memorySummary?.trim().replace(/\s+/g, " ");
                    const label = summary || "新会话";
                    const active = isSelected(selection,"project-session",session.id);
                    return (
                      <button
                        className={`project-session-link${active ? " active" : ""}`}
                        key={session.id}
                        title={label+(session.botParent?' · '+session.botParent.conversationTitle:'')}
                        aria-current={active ? "page" : undefined}
                        onClick={() => {
                          onSessionSelect(project.id, session.id);
                        }}
                      >
                        <span className={`project-session-link__dot project-session-link__dot--${session.state}`} aria-hidden="true" />
                        <span className="project-session-link__label">{label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </nav>
        <footer className="sidebar__footer">
          <button onClick={() => onOpenResource("agent")}><Settings2 size={14} />角色</button>
          <button onClick={() => onOpenResource("mcp")}><Settings2 size={14} />MCP</button>
        </footer>
      </aside>
  );
}
