import { ChevronDown, ChevronRight, FolderKanban, PanelLeftClose, PanelLeftOpen, Plus, Settings2, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Agent, FilePreview, Mcp, Project, RoomEntry } from "../domain/models";
import { FileBrowser, FilePreviewPane } from "../features/project-session/file-browser";
import { ProjectSessionCreatePanel } from "../features/project-session/project-session-create-panel";
import { ProjectSessionInspector, ProjectSessionView } from "../features/project-session/project-session-view";
import { ResourcePanel } from "../features/resources/resource-panel";
import { RoomCreatePanel } from "../features/room/room-create-panel";
import { RoomView } from "../features/room/room-view";
import { useAppState } from "../hooks/use-app-state";
import { useProjectSession } from "../hooks/use-project-session";
import { useProjectSessionNavigation } from "../hooks/use-project-session-navigation";

type ResourceKind = "project" | "agent" | "mcp";

export function App() {
  const state = useAppState();
  const [resourceKind, setResourceKind] = useState<ResourceKind | null>(null);
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [projectSessionCreateOpen, setProjectSessionCreateOpen] = useState(false);
  const [creatingSessionProjectId, setCreatingSessionProjectId] = useState<string | null>(null);
  const creatingSessionProjectIdRef = useRef<string | null>(null);
  const [roomCreateOpen, setRoomCreateOpen] = useState(false);
  const [projectDeleteConfirmOpen, setProjectDeleteConfirmOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [projectNavCollapsed, setProjectNavCollapsed] = useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [sessionSelectionByProject, setSessionSelectionByProject] = useState<Record<string, string>>({});
  const selectedProject = state.projects.find((item) => item.id === state.selectedProjectId) ?? null;
  const selectedRoom = state.rooms.find((item) => item.room.id === state.selectedRoomId)?.room ?? null;
  const sessionNavigation = useProjectSessionNavigation();
  const preferredSessionId = selectedProject ? sessionSelectionByProject[selectedProject.id] : undefined;
  const projectSession = useProjectSession(selectedRoom ? null : selectedProject, preferredSessionId);
  useEffect(() => {
    if (selectedProject && projectSession.loadedProjectId === selectedProject.id && projectSession.sessions.length > 0) {
      sessionNavigation.updateProjectSessions(selectedProject.id, projectSession.sessions);
    }
  }, [projectSession.loadedProjectId, projectSession.sessions, selectedProject, sessionNavigation.updateProjectSessions]);
  const selectedResource = resourceKind && resourceId
    ? resourceKind === "project"
      ? state.projects.find((item) => item.id === resourceId)
      : resourceKind === "agent"
        ? state.agents.find((item) => item.id === resourceId)
        : state.mcps.find((item) => item.id === resourceId)
    : null;

  function openResource(kind: ResourceKind, id?: string) {
    setResourceKind(kind);
    setResourceId(id ?? null);
    setProjectDeleteConfirmOpen(false);
    setFileBrowserOpen(false);
    setFilePreview(null);
    setPanelOpen(kind !== "project");
  }

  function closeProjectDialog() {
    setResourceKind(null);
    setResourceId(null);
    setProjectDeleteConfirmOpen(false);
  }

  function openPanel() {
    setResourceKind(null);
    setResourceId(null);
    setFileBrowserOpen(false);
    setPanelOpen(true);
  }

  function openFilePanel() {
    setResourceKind(null);
    setResourceId(null);
    setFileBrowserOpen(true);
    setPanelOpen(true);
  }

  async function createProjectSession(projectId: string) {
    const project = state.projects.find((item) => item.id === projectId && item.status === "active");
    if (!project || creatingSessionProjectIdRef.current) return;
    creatingSessionProjectIdRef.current = projectId;
    setCreatingSessionProjectId(projectId);
    try {
      const session = await sessionNavigation.createProjectSession(projectId);
      setSessionSelectionByProject((current) => ({ ...current, [projectId]: session.id }));
      setFileBrowserOpen(false);
      setFilePreview(null);
      setPanelOpen(false);
      setResourceKind(null);
      setResourceId(null);
      setProjectSessionCreateOpen(false);
      state.selectProject(projectId);
    } catch (cause) {
      state.setError(cause instanceof Error ? cause.message : "无法创建项目会话");
    } finally {
      creatingSessionProjectIdRef.current = null;
      setCreatingSessionProjectId(null);
    }
  }

  const activeProjectCount = state.projects.filter((item) => item.status === "active").length;
  const activeProjects = state.projects.filter((item) => item.status === "active");

  return (
    <div className={`app-shell${panelOpen ? " app-shell--panel-open" : ""}${filePreview ? " app-shell--file-preview-open" : ""}${projectNavCollapsed ? " app-shell--project-nav-collapsed" : ""}`}>
      <aside className="sidebar" id="project-navigation">
        <div className="sidebar__actions">
          <button onClick={() => openResource("project")}><Plus size={14} />新建项目</button>
          <button onClick={() => setProjectSessionCreateOpen(true)}><Plus size={14} />新建项目会话</button>
          <button disabled={activeProjectCount < 2} onClick={() => setRoomCreateOpen(true)}><Plus size={14} />新建跨项目会话</button>
        </div>
        <nav className="sidebar__nav" aria-label="项目导航">
          <div className="sidebar__label">项目</div>
          {state.projects.map((project) => (
            <div className="project-nav-entry" key={project.id}>
              <div className="nav-row">
                <button
                  className={`project-link${state.selectedProjectId === project.id && !selectedRoom ? " active" : ""}`}
                  aria-expanded={sessionNavigation.expandedProjectIds.has(project.id)}
                  onClick={() => {
                    setFileBrowserOpen(false);
                    setFilePreview(null);
                    setSessionSelectionByProject((current) => {
                      if (!current[project.id]) return current;
                      const next = { ...current };
                      delete next[project.id];
                      return next;
                    });
                    sessionNavigation.toggleProject(project.id);
                    state.selectProject(project.id);
                  }}
                >
                  <FolderKanban size={15} /><span>{project.name}</span>
                </button>
                <button
                  className="nav-icon"
                  aria-label={`新建 ${project.name} 的项目会话`}
                  title={`新建 ${project.name} 的项目会话`}
                  disabled={project.status !== "active" || creatingSessionProjectId !== null}
                  onClick={() => void createProjectSession(project.id)}
                >
                  <Plus size={13} />
                </button>
                <button
                  className="project-session-toggle"
                  aria-label={`${sessionNavigation.expandedProjectIds.has(project.id) ? "收起" : "展开"}${project.name}的会话记录`}
                  aria-expanded={sessionNavigation.expandedProjectIds.has(project.id)}
                  onClick={() => sessionNavigation.toggleProject(project.id)}
                >
                  {sessionNavigation.expandedProjectIds.has(project.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <button className="nav-icon" aria-label={`编辑 ${project.name}`} onClick={() => openResource("project", project.id)}>
                  <Settings2 size={13} />
                </button>
              </div>
              {sessionNavigation.expandedProjectIds.has(project.id) && (
                <div className="project-sessions" aria-label={`${project.name}的会话记录`}>
                  {sessionNavigation.loadingProjectIds.has(project.id) && <div className="project-sessions__message" role="status">正在加载会话记录…</div>}
                  {sessionNavigation.errorsByProject[project.id] && <button className="project-sessions__message project-sessions__message--error" onClick={() => void sessionNavigation.loadProjectSessions(project.id, true)}>加载失败，点击重试</button>}
                  {!sessionNavigation.loadingProjectIds.has(project.id) && !sessionNavigation.errorsByProject[project.id] && (sessionNavigation.sessionsByProject[project.id] ?? []).length === 0 && <div className="project-sessions__message">暂无会话记录</div>}
                  {[...(sessionNavigation.sessionsByProject[project.id] ?? [])].reverse().map((session, index, sessions) => {
                    const label = session.purpose.trim() || `工作线 ${sessions.length - index}`;
                    const active = !selectedRoom && selectedProject?.id === project.id && projectSession.sessionId === session.id;
                    return (
                      <button
                        className={`project-session-link${active ? " active" : ""}`}
                        key={session.id}
                        title={label}
                        aria-current={active ? "page" : undefined}
                        onClick={() => {
                          setFileBrowserOpen(false);
                          setFilePreview(null);
                          setSessionSelectionByProject((current) => ({ ...current, [project.id]: session.id }));
                          state.selectProject(project.id);
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
          {state.rooms.length > 0 && (
            <>
              <div className="sidebar__label sidebar__label--rooms">跨项目会话</div>
              {state.rooms.map((entry) => (
                <RoomLink
                  key={entry.room.id}
                  entry={entry}
                  active={state.selectedRoomId === entry.room.id}
                  onClick={() => { setFileBrowserOpen(false); setFilePreview(null); state.selectRoom(entry.room.id); }}
                />
              ))}
            </>
          )}
        </nav>
        <footer className="sidebar__footer">
          <button onClick={() => openResource("agent")}><Settings2 size={14} />Agent</button>
          <button onClick={() => openResource("mcp")}><Settings2 size={14} />MCP</button>
        </footer>
      </aside>

      <section className="main-column">
        <div className="main-toolbar">
          <div className="main-toolbar__leading">
            <button
              className="project-nav-toggle"
              type="button"
              aria-label={projectNavCollapsed ? "展开项目导航" : "收起项目导航"}
              aria-controls="project-navigation"
              aria-expanded={!projectNavCollapsed}
              title={projectNavCollapsed ? "展开项目导航" : "收起项目导航"}
              onClick={() => setProjectNavCollapsed((collapsed) => !collapsed)}
            >
              {projectNavCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            <span>{selectedRoom?.title ?? selectedProject?.name ?? "项目工作台"}</span>
          </div>
          <div className="main-toolbar__actions">
            <button
              aria-pressed={panelOpen && fileBrowserOpen}
              disabled={!selectedProject}
              onClick={openFilePanel}
            >文件</button>
            <button aria-pressed={panelOpen && !fileBrowserOpen} onClick={openPanel}>检查</button>
            {panelOpen && <button className="main-toolbar__close" aria-label={`关闭${fileBrowserOpen ? "文件" : "检查"}面板`} onClick={() => setPanelOpen(false)}><X size={15} /></button>}
          </div>
        </div>
        <div className="main-canvas">
          {selectedRoom ? (
            <RoomView
              room={selectedRoom}
              onUpdate={(body) => void state.updateRoom(selectedRoom.id, body)}
              onDelete={() => void state.deleteRoom(selectedRoom.id)}
            />
          ) : selectedProject ? (
            <ProjectSessionView project={selectedProject} session={projectSession} />
          ) : (
            <main className="surface">
              <div className="empty-state">
                <h1>{state.loading ? "正在加载项目…" : state.error || "暂无项目"}</h1>
                {!state.loading && <p>从左侧创建项目或跨项目会话。</p>}
              </div>
            </main>
          )}
        </div>
      </section>

      {filePreview && selectedProject && !selectedRoom && (
        <FilePreviewPane
          projectName={selectedProject.name}
          rootPath={selectedProject.rootPath}
          preview={filePreview}
          onClose={() => setFilePreview(null)}
        />
      )}

      {resourceKind === "project" && (
        <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) closeProjectDialog(); }}>
          <section className="modal resource-modal" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title">
            <header>
              <div><span className="eyebrow">Project</span><h2 id="project-dialog-title">{resourceId ? "项目设置" : "新建项目"}</h2></div>
              <button aria-label="关闭项目弹窗" onClick={closeProjectDialog}><X size={16} /></button>
            </header>
            <ResourcePanel
              key={resourceId ?? "new-project"}
              kind="project"
              resource={selectedResource}
              onClose={closeProjectDialog}
              onSave={(body) => {
                void state.saveResource("project", resourceId, body);
                closeProjectDialog();
              }}
              onDelete={resourceId ? () => setProjectDeleteConfirmOpen(true) : undefined}
            />
          </section>
        </div>
      )}

      {projectDeleteConfirmOpen && resourceId && (
        <div className="modal-backdrop modal-backdrop--nested">
          <section className="modal" role="alertdialog" aria-modal="true" aria-labelledby="project-delete-title">
            <header><h2 id="project-delete-title">删除项目？</h2><button aria-label="关闭确认弹窗" onClick={() => setProjectDeleteConfirmOpen(false)}><X size={16} /></button></header>
            <p className="modal__description">确定删除“{state.projects.find((project) => project.id === resourceId)?.name ?? "此项目"}”吗？如果项目仍被会话或任务引用，系统会阻止删除。</p>
            <footer>
              <button onClick={() => setProjectDeleteConfirmOpen(false)}>取消</button>
              <button className="danger" onClick={() => { const id = resourceId; closeProjectDialog(); void state.deleteResource("project", id); }}>删除项目</button>
            </footer>
          </section>
        </div>
      )}

      {panelOpen && (
        <aside className="context-panel" aria-label={fileBrowserOpen ? "项目文件面板" : "检查面板"}>
          <header className="context-panel__header">
            <b>{fileBrowserOpen ? "项目文件" : "检查"}</b>
            <button className="context-panel__close" aria-label={`关闭${fileBrowserOpen ? "文件" : "检查"}面板`} onClick={() => setPanelOpen(false)}><X size={15} /></button>
          </header>
          {fileBrowserOpen && selectedProject && !selectedRoom ? (
            <FileBrowser key={selectedProject.id} projectId={selectedProject.id} projectName={selectedProject.name} rootPath={selectedProject.rootPath} onOpenFile={setFilePreview} />
          ) : resourceKind && resourceKind !== "project" ? (
            <ResourcePanel
              kind={resourceKind}
              resource={selectedResource}
              onClose={() => setResourceKind(null)}
              onSave={(body) => void state.saveResource(resourceKind, resourceId, body)}
              onDelete={resourceId ? () => void state.deleteResource(resourceKind, resourceId) : undefined}
            />
          ) : !selectedRoom && selectedProject ? (
            <ProjectSessionInspector project={selectedProject} session={projectSession} />
          ) : (
            <ResourceIndex projects={state.projects} agents={state.agents} mcps={state.mcps} onOpen={openResource} />
          )}
        </aside>
      )}

      {roomCreateOpen && (
        <RoomCreatePanel
          projects={state.projects}
          onClose={() => setRoomCreateOpen(false)}
          onCreate={(ids, title) => {
            setRoomCreateOpen(false);
            setFileBrowserOpen(false);
            setFilePreview(null);
            void state.createRoom(ids, title);
          }}
        />
      )}
      {projectSessionCreateOpen && (
        <ProjectSessionCreatePanel
          projects={activeProjects}
          creatingProjectId={creatingSessionProjectId}
          onClose={() => setProjectSessionCreateOpen(false)}
          onSelectProject={(projectId) => void createProjectSession(projectId)}
          onCreateProject={() => {
            setProjectSessionCreateOpen(false);
            openResource("project");
          }}
        />
      )}
      {state.error && <button className="error-banner" onClick={() => state.setError("")}>{state.error}<Trash2 size={13} /></button>}
    </div>
  );
}

function RoomLink({ entry, active, onClick }: { entry: RoomEntry; active: boolean; onClick: () => void }) {
  return (
    <button className={`project-link${active ? " active" : ""}`} onClick={onClick}>
      <Sparkles size={15} /><span>{entry.room.title}</span>
    </button>
  );
}

function PanelEmptyState({ detail }: { detail: string }) {
  return <div className="column-empty"><b>文件</b><p>{detail}</p></div>;
}

function ResourceIndex({
  projects,
  agents,
  mcps,
  onOpen,
}: {
  projects: Project[];
  agents: Agent[];
  mcps: Mcp[];
  onOpen: (kind: ResourceKind, id?: string) => void;
}) {
  return (
    <div className="inspector__body">
      <ResourceList title="项目" kind="project" values={projects} onOpen={onOpen} />
      <ResourceList title="Agent" kind="agent" values={agents} onOpen={onOpen} />
      <ResourceList title="MCP" kind="mcp" values={mcps} onOpen={onOpen} />
    </div>
  );
}

function ResourceList({
  title,
  kind,
  values,
  onOpen,
}: {
  title: string;
  kind: ResourceKind;
  values: Array<{ id: string; name: string }>;
  onOpen: (kind: ResourceKind, id?: string) => void;
}) {
  return (
    <section className="resource-list">
      <div className="resource-list__heading">
        <b>{title}</b>
        <button aria-label={`新建${title}`} onClick={() => onOpen(kind)}><Plus size={13} /></button>
      </div>
      {values.map((item) => <button key={item.id} onClick={() => onOpen(kind, item.id)}>{item.name}</button>)}
    </section>
  );
}
