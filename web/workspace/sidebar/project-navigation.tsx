import {Button} from '../../components/button';
import { ErrorToast } from '../conversation/error-toast';
import {sessionLabel,sessionActivity} from "./session-label";
import {isSelected,type WorkspaceSelection} from "./workspace-selection";
import { ChevronDown, ChevronRight, FolderKanban, Plus, Settings2, LoaderCircle, Trash2 } from "lucide-react";
import type { Project } from "../../domain/models";
import { useProjectSessionNavigation } from "./use-project-session-navigation";

type ResourceKind = "agent" | "mcp";

export function ProjectNavigation({ activity, deletingSessionId, onDeleteSession, projects, selection, navigation, creatingSessionProjectId, onNewProject, onNewProjectSession, workspaceNavigation, onCreateSession, onSessionSelect, onEditProject, onOpenResource }: {
  activity: Record<string, string[] | null>;
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
  onSessionSelect: (projectId: string, sessionId: string) => void;
  onEditProject: (projectId: string) => void;
  onOpenResource: (kind: ResourceKind) => void;
}) {
  return (
      <aside className="sidebar" id="project-navigation">
        <div className="sidebar__actions">
          <Button variant="primary" onClick={() => onNewProjectSession()}><Plus size={14} />新建项目会话</Button>

        </div>
        <nav className="sidebar__nav" aria-label="项目导航">
          {workspaceNavigation}
          <div className="sidebar__label project-navigation__section-heading"><span>项目</span><Button variant="ghost" size="icon" className="nav-icon" type="button" aria-label="新建项目" title="新建项目" onClick={onNewProject}><Plus size={14}/></Button></div>
          {projects.map((project) => (
            <div className="project-nav-entry" key={project.id}>
              <div className="nav-row">
                <Button variant="ghost" size="row"
                  className={`project-link${isSelected(selection,"project",project.id) ? " active" : ""}`}
                  aria-current={isSelected(selection,"project",project.id)?"page":undefined}
                  aria-expanded={navigation.expandedProjectIds.has(project.id)}
                  onClick={() => navigation.toggleProject(project.id)}
                >
                  <FolderKanban size={15} className="shrink-0" /><span className="min-w-0 truncate">{project.name}</span>{activity[`project:${project.id}`] === null ? <span className="navigation-running-count">运行状态不可用</span> : !!activity[`project:${project.id}`]?.length && <span className="navigation-running-count">{activity[`project:${project.id}`]!.length} 运行中</span>}
                </Button>
                <Button variant="ghost" size="icon"
                  className="nav-icon"
                  aria-label={`新建 ${project.name} 的项目会话`}
                  title={`新建 ${project.name} 的项目会话`}
                  disabled={project.status !== "active" || creatingSessionProjectId !== null}
                  onClick={() => void onCreateSession(project.id)}
                >
                  <Plus size={13} />
                </Button>
                <Button variant="ghost" size="icon"
                  className="project-session-toggle"
                  aria-label={`${navigation.expandedProjectIds.has(project.id) ? "收起" : "展开"}${project.name}的会话记录`}
                  aria-expanded={navigation.expandedProjectIds.has(project.id)}
                  onClick={() => navigation.toggleProject(project.id)}
                >
                  {navigation.expandedProjectIds.has(project.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </Button>
                <Button variant="ghost" size="icon" className="nav-icon" aria-label={`编辑 ${project.name}`} onClick={() => onEditProject(project.id)}>
                  <Settings2 size={13} />
                </Button>
              </div>
              {navigation.expandedProjectIds.has(project.id) && (
                <div className="project-sessions" aria-label={`${project.name}的会话记录`}>
                  {navigation.loadingProjectIds.has(project.id) && <div className="project-sessions__message" role="status">正在加载会话记录…</div>}
                  <ErrorToast message={navigation.errorsByProject[project.id]} onRetry={() => void navigation.loadProjectSessions(project.id, true)}/>
                  {!navigation.loadingProjectIds.has(project.id) && !navigation.errorsByProject[project.id] && (navigation.sessionsByProject[project.id] ?? []).length === 0 && <div className="project-sessions__message">暂无独立会话记录</div>}
                  {([...(navigation.sessionsByProject[project.id] ?? [])]).reverse().map((session) => {
                    const label = sessionLabel(session);
                    const active = isSelected(selection,"project-session",session.id);
                    const running = activity[`project:${project.id}`] === undefined ? session.allowedActions.interrupt.allowed : activity[`project:${project.id}`]?.includes(session.id) === true;
                    return (
                      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_32px] items-center gap-1" key={session.id}>
                      <Button variant="ghost" size="session"
                        className={`project-session-link${active ? " active" : ""}`}
                        title={label}
                        aria-current={active ? "page" : undefined}
                        onClick={() => {
                          onSessionSelect(project.id, session.id);
                        }}
                      >
                        {running ? <LoaderCircle size={12} className="spin shrink-0 text-sky-700" aria-hidden="true" /> : <span className={`project-session-link__dot project-session-link__dot--${session.status==='open'?'idle':'not_started'}`} aria-hidden="true" />}
                        <span className="min-w-0 flex-1 text-left"><span className="block truncate leading-4">{label}</span><span className="block truncate text-[10px] leading-3 font-normal text-slate-400" title={session.lastOpenedAt?new Date(session.lastOpenedAt).toLocaleString():undefined}>{sessionActivity(session)}</span></span>{running && <span className="navigation-running-count">运行中</span>}
                      </Button>
                      <Button variant="ghost" size="icon" type="button" className="nav-icon" aria-label={`删除会话：${label}`} title="删除会话" disabled={deletingSessionId !== null} onClick={() => onDeleteSession(project.id, session.id, label)}><Trash2 size={13}/></Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </nav>
        <footer className="sidebar__footer">
          <Button variant="ghost" size="row" onClick={() => onOpenResource("agent")}><Settings2 size={14} />助手</Button>
          <Button variant="ghost" size="row" onClick={() => onOpenResource("mcp")}><Settings2 size={14} />MCP</Button>
        </footer>
      </aside>
  );
}
