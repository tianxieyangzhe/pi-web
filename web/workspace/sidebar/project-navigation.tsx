import {sessionLabel,sessionActivity} from "./session-label";
import {isSelected,type WorkspaceSelection} from "./workspace-selection";
import { ChevronDown, ChevronRight, FolderKanban, Plus, Settings2, Sparkles, Trash2 } from "lucide-react";
import type { Project } from "../../domain/models";
import { useProjectSessionNavigation } from "./use-project-session-navigation";

type ResourceKind = "agent" | "mcp";

export function ProjectNavigation({ deletingSessionId, onDeleteSession, projects, selection, navigation, creatingSessionProjectId, onNewProject, onNewProjectSession, workspaceNavigation, onCreateSession, onProjectSelect, onSessionSelect, onEditProject, onOpenResource }: {
  deletingSessionId: string | null;
  onDeleteSession: (projectId: string, sessionId: string, label: string) => void;
  projects: Project[];
  selection:WorkspaceSelection|null;
  navigation: ReturnType<typeof useProjectSessionNavigation>;
  creatingSessionProjectId: string | null;
  onNewProject: () => void;
  onNewProjectSession: () => void;
  workspaceNavigation?: import("react").ReactNode;
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

        </div>
        <nav className="sidebar__nav" aria-label="项目导航">
          {workspaceNavigation}
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
                    const label = sessionLabel(session);
                    const active = isSelected(selection,"project-session",session.id);
                    return (
                      <div className="flex min-w-0 items-center gap-1" key={session.id}>
                      <button
                        className={`project-session-link flex-1${active ? " active" : ""}`}
                        title={label+(session.botParent?' · '+session.botParent.conversationTitle:'')}
                        aria-current={active ? "page" : undefined}
                        onClick={() => {
                          onSessionSelect(project.id, session.id);
                        }}
                      >
                        <span className={`project-session-link__dot project-session-link__dot--${session.status==='open'?'idle':'not_started'}`} aria-hidden="true" />
                        <span className="min-w-0 flex-1 text-left"><span className="block truncate">{label}</span><span className="mt-0.5 block truncate text-[10px] font-normal text-slate-400" title={session.lastOpenedAt?new Date(session.lastOpenedAt).toLocaleString():undefined}>{sessionActivity(session)}</span></span>
                      </button>
                      <button type="button" className="nav-icon shrink-0" aria-label={`删除会话：${label}`} title="删除会话" disabled={deletingSessionId !== null} onClick={() => onDeleteSession(project.id, session.id, label)}><Trash2 size={13}/></button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </nav>
        <footer className="sidebar__footer">
          <button onClick={() => onOpenResource("agent")}><Settings2 size={14} />Agent</button>
          <button onClick={() => onOpenResource("mcp")}><Settings2 size={14} />MCP</button>
        </footer>
      </aside>
  );
}
