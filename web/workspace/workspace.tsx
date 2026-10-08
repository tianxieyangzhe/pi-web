import { PanelLeftClose, PanelLeftOpen, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FilePreview } from "../domain/models";
import { FilePreviewPane } from "./files/file-browser";
import { ProjectSessionCreateDialog } from "./sidebar/project-session-create-dialog";
import { ProjectSessionView } from "./conversation/project-session/project-session-view";
import { ProjectDialog } from "./sidebar/project-dialog";
import { ProjectNavigation } from "./sidebar/project-navigation";
import { ContextPanel } from "./inspector/context-panel";
import { useWorkspaceState } from "./use-workspace-state";
import { useProjectSession } from "./conversation/project-session/use-project-session";
import { useProjectSessionNavigation } from "./sidebar/use-project-session-navigation";

type ResourceKind = "project" | "agent" | "mcp";

export function Workspace() {
  const state = useWorkspaceState();
  const [resourceKind, setResourceKind] = useState<ResourceKind | null>(null);
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [templateLibraryOpen,setTemplateLibraryOpen]=useState(false);
  const [projectSessionCreateOpen, setProjectSessionCreateOpen] = useState(false);
  const [creatingSessionProjectId, setCreatingSessionProjectId] = useState<string | null>(null);
  const creatingSessionProjectIdRef = useRef<string | null>(null);
  const [crossProjectOpen,setCrossProjectOpen]=useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [projectNavCollapsed, setProjectNavCollapsed] = useState(false);
  const [panelView, setPanelView] = useState<"memory" | "files" | "check">("check");
  const fileBrowserOpen = panelView === "files";
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [sessionSelectionByProject, setSessionSelectionByProject] = useState<Record<string, string>>({});
  const selectedProject = state.projects.find((item) => item.id === state.selectedProjectId) ?? null;
  const sessionNavigation = useProjectSessionNavigation();
  const preferredSessionId = selectedProject ? sessionSelectionByProject[selectedProject.id] : undefined;
  const projectSession = useProjectSession(crossProjectOpen ? null : selectedProject, preferredSessionId, panelOpen && panelView==="memory" && !resourceKind);
  useEffect(() => {
    if (selectedProject && projectSession.loadedProjectId === selectedProject.id && projectSession.sessions.length > 0) {
      sessionNavigation.updateProjectSessions(selectedProject.id, projectSession.sessions);
    }
  }, [projectSession.loadedProjectId, projectSession.sessions, selectedProject, sessionNavigation.updateProjectSessions]);

  function cancelMemoryEditing(){return window.dispatchEvent(new Event("memory-before-leave",{cancelable:true}));}

  function closeSessionDisplays() {
    window.dispatchEvent(new Event("memory-before-leave"));
    setPanelOpen(false);
    setFilePreview(null);
    setResourceKind(null);
    setResourceId(null);
    setTemplateLibraryOpen(false);
    setProjectSessionCreateOpen(false);
    setCrossProjectOpen(false);
  }

  const displayedSession = useRef<string | null>(null);
  useEffect(() => {
    const next = selectedProject && projectSession.sessionId ? `${selectedProject.id}:${projectSession.sessionId}` : null;
    if (next && displayedSession.current && next !== displayedSession.current) closeSessionDisplays();
    displayedSession.current = next;
  }, [selectedProject?.id, projectSession.sessionId]);

  function openResource(kind: ResourceKind, id?: string) {
    setResourceKind(kind);
    setResourceId(id ?? null);
    setPanelView("check");
    setFilePreview(null);
    setPanelOpen(kind !== "project");
  }

  function closeProjectDialog() {
    setResourceKind(null);
    setResourceId(null);
  }

  function openPanel(view: "memory" | "files" | "check") {
    setResourceKind(null);
    setResourceId(null);
    setPanelView(view);
    setPanelOpen(true);
  }

  function openFilePanel() { openPanel("files"); }

  async function createProjectSession(projectId: string, body: Record<string,unknown> = {}) {
    if(!cancelMemoryEditing())return;
    const project = state.projects.find((item) => item.id === projectId && item.status === "active");
    if (!project || creatingSessionProjectIdRef.current) return;
    creatingSessionProjectIdRef.current = projectId;
    setCreatingSessionProjectId(projectId);
    try {
      const session = await sessionNavigation.createProjectSession(projectId,body);
      setSessionSelectionByProject((current) => ({ ...current, [projectId]: session.id }));
      setPanelView("check");
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

  const activeProjects = state.projects.filter((item) => item.status === "active");

  return (
    <div className={`app-shell${panelOpen ? " app-shell--panel-open" : ""}${filePreview ? " app-shell--file-preview-open" : ""}${projectNavCollapsed ? " app-shell--project-nav-collapsed" : ""}`}>
      <ProjectNavigation
        projects={state.projects}
        selectedProjectId={state.selectedProjectId}
        activeSessionId={projectSession.sessionId}
        navigation={sessionNavigation}
        creatingSessionProjectId={creatingSessionProjectId}
        onNewProject={() => openResource("project")}
        onOpenTemplates={()=>setTemplateLibraryOpen(true)}
        onNewProjectSession={() => setProjectSessionCreateOpen(true)}
        onOpenCrossProject={()=>{closeSessionDisplays();setCrossProjectOpen(true);}}
        onCreateSession={(projectId) => void createProjectSession(projectId)}
        onProjectSelect={(projectId) => {
          closeSessionDisplays();
          setSessionSelectionByProject((current) => {
            if (!current[projectId]) return current;
            const next = { ...current };
            delete next[projectId];
            return next;
          });
          state.selectProject(projectId);
        }}
        onSessionSelect={(projectId, sessionId) => {
          closeSessionDisplays();
          setSessionSelectionByProject((current) => ({ ...current, [projectId]: sessionId }));
          state.selectProject(projectId);
        }}
        onEditProject={(projectId) => openResource("project", projectId)}
        onOpenResource={(kind) => openResource(kind)}
      />

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
            <span>{crossProjectOpen ? "跨项目会话" : selectedProject?.name ?? "项目工作台"}</span>
          </div>
          <div className="main-toolbar__actions">
            <nav className="main-toolbar__panel-switcher" aria-label="右侧面板">
              <button type="button" aria-pressed={panelOpen && !resourceKind && panelView === "memory"} disabled={!selectedProject || crossProjectOpen} onClick={() => openPanel("memory")}>记忆</button>
              <button type="button" aria-pressed={panelOpen && !resourceKind && panelView === "files"} disabled={!selectedProject} onClick={openFilePanel}>文件</button>
              <button type="button" aria-pressed={panelOpen && !resourceKind && panelView === "check"} onClick={() => openPanel("check")}>检查</button>
            </nav>
            {panelOpen && <button className="main-toolbar__close" aria-label="关闭右侧面板" onClick={() => setPanelOpen(false)}><X size={15} /></button>}
          </div>
        </div>
        <div className="main-canvas">
          {crossProjectOpen ? (
            <main className="surface"><div className="empty-state"><h1>跨项目会话</h1><p>待设计。执行流程将在后续定义。</p></div></main>
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

      {filePreview && selectedProject && !crossProjectOpen && (
        <FilePreviewPane
          projectName={selectedProject.name}
          rootPath={selectedProject.rootPath}
          preview={filePreview}
          onClose={() => setFilePreview(null)}
        />
      )}

      <ProjectDialog
        key={resourceId ?? "new-project"}
        open={resourceKind === "project"}
        project={resourceKind === "project" ? state.projects.find((project) => project.id === resourceId) ?? null : null}
        onClose={closeProjectDialog}
        onSave={(body) => void state.saveResource("project", resourceId, body)}
        onDelete={(id) => void state.deleteResource("project", id)}
      />

      {panelOpen && <ContextPanel
        visible={panelOpen}
        panelView={panelView}
        selectedProject={selectedProject}
                session={projectSession}
        resourceKind={resourceKind}
        resourceId={resourceId}
        selectedResource={resourceKind === "agent" ? state.agents.find((item) => item.id === resourceId) ?? null : resourceKind === "mcp" ? state.mcps.find((item) => item.id === resourceId) ?? null : null}
        projects={state.projects}
        agents={state.agents}
        mcps={state.mcps}
        onClose={() => setPanelOpen(false)}
        onOpenFile={setFilePreview}
        onOpenResource={openResource}
        onSaveResource={(kind, id, body) => void state.saveResource(kind, id, body)}
        onDeleteResource={(kind, id) => void state.deleteResource(kind, id)}
      />}

      {templateLibraryOpen&&<ProjectSessionCreateDialog libraryOnly projects={activeProjects} creatingProjectId={null} onClose={()=>setTemplateLibraryOpen(false)} onSelectProject={()=>{}} onCreateProject={()=>{}}/>}
      {projectSessionCreateOpen && (
        <ProjectSessionCreateDialog
          projects={activeProjects}
          creatingProjectId={creatingSessionProjectId}
          onClose={() => setProjectSessionCreateOpen(false)}
          onSelectProject={(projectId,template) => void createProjectSession(projectId,template)}
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
