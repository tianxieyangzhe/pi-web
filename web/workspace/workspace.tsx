import {selectedProjectId as selectionProjectId,type WorkspaceSelection} from "./sidebar/workspace-selection";
import {RoleDirectory} from './roles/role-directory';
import {RoleEditor,type RoleTarget} from './roles/role-editor';
import {BotHome} from './roles/bot-home';
import {RoleSelector} from './roles/role-selector';
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
import {BotNavigation} from "./sidebar/bot-navigation";
import {BotCreateDialog} from "./sidebar/bot-create-dialog";
import {BotConversationView} from "./conversation/bot-conversation/bot-conversation-view";
import {useBotConversation} from "./conversation/bot-conversation/use-bot-conversation";
import {BotPanel} from "./inspector/bot-panel";
import {botApi} from "../api/bot-client";
import type {BotOverview} from "../domain/bot";
import { useProjectSessionNavigation } from "./sidebar/use-project-session-navigation";

type ResourceKind = "project" | "agent" | "mcp";

export function Workspace() {
  const state = useWorkspaceState();
  const [rolesOpen,setRolesOpen]=useState(false);
  const [roleEditorTarget,setRoleEditorTarget]=useState<RoleTarget|null>(null);
  const [selection,setSelection]=useState<WorkspaceSelection|null>(null);
  const botHomeId=selection?.kind==='bot'?selection.botId:null;
  const [sessionProjectId,setSessionProjectId]=useState<string|null>(null);
  const [sessionRoleId,setSessionRoleId]=useState('');
  const [sessionCreateBody,setSessionCreateBody]=useState<Record<string,unknown>>({});
  const [resourceKind, setResourceKind] = useState<ResourceKind | null>(null);
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [templateLibraryOpen,setTemplateLibraryOpen]=useState(false);
  const [projectSessionCreateOpen, setProjectSessionCreateOpen] = useState(false);
  const [creatingSessionProjectId, setCreatingSessionProjectId] = useState<string | null>(null);
  const creatingSessionProjectIdRef = useRef<string | null>(null);
  const [botOverview,setBotOverview]=useState<BotOverview|null>(null);
  const botSelection=selection?.kind==='bot-conversation'?{botId:selection.botId,conversationId:selection.conversationId}:null;
  const [botCreate,setBotCreate]=useState<string|true|null>(null);
  const [botPanelView,setBotPanelView]=useState<"sessions"|"files"|"check">("sessions");
  const botConversationOpen=selection?.kind==='bot-conversation';
  async function reloadBots(){try{setBotOverview(await botApi.list());}catch(cause){state.setError(cause instanceof Error?cause.message:"无法加载 Bot");}}
  useEffect(()=>{void reloadBots();},[]);
  const botConversation=useBotConversation(botSelection?.botId??null,botSelection?.conversationId??null);
  useEffect(()=>{const detail=botConversation.detail;if(!detail)return;setBotOverview(current=>current?{...current,bots:current.bots.map(b=>b.id===detail.bot.id?detail.bot:b),conversations:current.conversations.map(c=>c.id===detail.conversation.id?detail.conversation:c),participants:[...current.participants.filter(b=>b.botConversationId!==detail.conversation.id),...detail.participants]}:current);},[botConversation.detail]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [projectNavCollapsed, setProjectNavCollapsed] = useState(false);
  const [panelView, setPanelView] = useState<"memory" | "files" | "check">("check");
  const fileBrowserOpen = panelView === "files";
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [sessionSelectionByProject, setSessionSelectionByProject] = useState<Record<string, string>>({});
  const selectedProject = state.projects.find((item) => item.id === selectionProjectId(selection)) ?? null;
  const sessionNavigation = useProjectSessionNavigation();
  const preferredSessionId = selection?.kind==='project'&&selection.sessionId?selection.sessionId:selectedProject?sessionSelectionByProject[selectedProject.id]:undefined;
  useEffect(()=>{if(!state.loading&&state.projects.length)setSelection(current=>current??{kind:'project',projectId:state.projects[0].id});},[state.loading,state.projects]);
  const projectSession = useProjectSession(botConversationOpen||botHomeId ? null : selectedProject, preferredSessionId, panelOpen && panelView==="memory" && !resourceKind);
  const activeProjectSession=projectSession.loadedProjectId===selectedProject?.id?projectSession.sessions.find(session=>session.id===projectSession.sessionId)??null:null;
  const projectSessionParent=activeProjectSession?.botParent??null;
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
    setBotCreate(null);
    setRolesOpen(false);setSessionProjectId(null);
  }

  const displayedSession = useRef<string | null>(null);
  useEffect(() => {
    const next = selectedProject && projectSession.sessionId ? `${selectedProject.id}:${projectSession.sessionId}` : null;
    if (next && displayedSession.current && next !== displayedSession.current) closeSessionDisplays();
    displayedSession.current = next;
  }, [selectedProject?.id, projectSession.sessionId]);

  function openResource(kind: ResourceKind, id?: string) {
    if(kind==='agent'){if(!roleEditorTarget)setRolesOpen(true);return;}
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

  function returnToRoleList(){setRoleEditorTarget(null);setRolesOpen(true);}

  function reviewAgentIssue(agentId:string,summary:string){
    const resource=state.agents.find(agent=>agent.id===agentId);
    if(!resource?.contentSha256){state.setError('此 Agent.md 版本不可编辑，请先在检查中处理角色版本问题。');return;}
    setRolesOpen(false);setPanelOpen(false);setFilePreview(null);
    setRoleEditorTarget({resource,initialFeedback:`请核对当前总对话报告的 Agent.md 疑点：${summary}\n请结合本次证据判断是否需要修订，保留原有职责与能力边界；不要增加或开启能力。`});
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
      setSessionProjectId(null);
      setSelection({kind:'project',projectId,sessionId:session.id});
    } catch (cause) {
      state.setError(cause instanceof Error ? cause.message : "无法创建项目会话");
    } finally {
      creatingSessionProjectIdRef.current = null;
      setCreatingSessionProjectId(null);
    }
  }

  function openBotPanel(view:"sessions"|"files"|"check"){setBotPanelView(view);setPanelOpen(true);}
  function selectBotConversation(conversationId:string){const c=botOverview?.conversations.find(x=>x.id===conversationId);if(!c)return;closeSessionDisplays();setSelection({kind:'bot-conversation',botId:c.botId,conversationId:c.id});}
  function selectBotParticipant(sessionId:string){const binding=botConversation.detail?.participants.find(x=>x.id===sessionId)??botOverview?.participants.find(x=>x.id===sessionId);if(!binding)return;closeSessionDisplays();setSelection({kind:'project',projectId:binding.projectId,sessionId:binding.id});setSessionSelectionByProject(s=>({...s,[binding.projectId]:binding.id}));}

  const activeProjects = state.projects.filter((item) => item.status === "active");

  return (
    <div className={`app-shell${panelOpen&&!roleEditorTarget ? " app-shell--panel-open" : ""}${filePreview&&!roleEditorTarget ? " app-shell--file-preview-open" : ""}${projectNavCollapsed ? " app-shell--project-nav-collapsed" : ""}${roleEditorTarget ? " app-shell--agent-editor" : ""}`}>
      <ProjectNavigation
        projects={state.projects}
        selection={selection}
        navigation={sessionNavigation}
        creatingSessionProjectId={creatingSessionProjectId}
        onNewProject={() => openResource("project")}
        onOpenTemplates={()=>setTemplateLibraryOpen(true)}
        onNewProjectSession={() => {closeSessionDisplays();setProjectSessionCreateOpen(true);}}
        botNavigation={<BotNavigation onBot={id=>{closeSessionDisplays();setSelection({kind:'bot',botId:id});}} value={botOverview} selection={selection} onCreate={()=>{closeSessionDisplays();setBotCreate(true);}} onNewConversation={async id=>{const b=botOverview?.bots.find(b=>b.id===id);if(!b?.coordinatorAgentSnapshot){closeSessionDisplays();setSelection({kind:'bot',botId:id});return;}try{const c=await botApi.createConversation(id,{});await reloadBots();closeSessionDisplays();setSelection({kind:'bot-conversation',botId:id,conversationId:c.id});}catch(e){state.setError(e instanceof Error?e.message:"无法创建 Bot 对话");}}} onConversation={selectBotConversation} onProjectSession={selectBotParticipant} onDeleteConversation={async conversationId=>{const c=botOverview?.conversations.find(item=>item.id===conversationId);if(!c)return;try{await botApi.updateConversation(c.botId,c,{status:'deleted'});if(selection?.kind==='bot-conversation'&&selection.conversationId===c.id||selection?.kind==='project'&&botOverview?.participants.some(item=>item.id===selection.sessionId&&item.botConversationId===c.id)){closeSessionDisplays();setSelection({kind:'bot',botId:c.botId});}await reloadBots();}catch(e){state.setError(e instanceof Error?e.message:'无法删除协调会话');}}}/>}
        onCreateSession={(projectId) => void createProjectSession(projectId)}
        onProjectSelect={(projectId) => {
          closeSessionDisplays();
          setSessionSelectionByProject((current) => {
            if (!current[projectId]) return current;
            const next = { ...current };
            delete next[projectId];
            return next;
          });
          setSelection({kind:'project',projectId});
        }}
        onSessionSelect={(projectId, sessionId) => {
          closeSessionDisplays();
          setSessionSelectionByProject((current) => ({ ...current, [projectId]: sessionId }));
          setSelection({kind:'project',projectId,sessionId});
        }}
        onEditProject={(projectId) => openResource("project", projectId)}
        onOpenResource={(kind) => openResource(kind)}
      />

      {roleEditorTarget&&<RoleEditor key={roleEditorTarget.resource?.id??`new-${roleEditorTarget.kind??"coordinator"}`} target={roleEditorTarget} projects={state.projects} onClose={returnToRoleList} onSaved={async()=>{await state.reload();returnToRoleList();}}/>}

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
            <span>{botSelection?`${botConversation.detail?.bot.name??"Bot"} / ${botConversation.detail?.conversation.title??"总对话"}`:projectSessionParent?`${botOverview?.bots.find(b=>b.id===projectSessionParent.botId)?.name??"Bot"} / ${projectSessionParent.conversationTitle} / ${activeProjectSession?.agentSnapshot?.name??"项目会话"}`:botHomeId?(botOverview?.bots.find(b=>b.id===botHomeId)?.name??"Bot"):selectedProject?.name??"项目工作台"}</span>
          </div>
          <div className="main-toolbar__actions">
            <nav className="main-toolbar__panel-switcher" aria-label="右侧面板">
              <button type="button" aria-pressed={panelOpen && !resourceKind && (botConversationOpen?botPanelView==="sessions":panelView === "memory")} disabled={!selectedProject&&!botConversationOpen} onClick={() => botConversationOpen?openBotPanel("sessions"):openPanel("memory")}>{botConversationOpen?"项目":"记忆"}</button>
              <button type="button" aria-pressed={panelOpen && !resourceKind && (botConversationOpen?botPanelView==="files":panelView === "files") } disabled={!selectedProject&&!botConversationOpen} onClick={()=>botConversationOpen?openBotPanel("files"):openFilePanel()}>文件</button>
              <button type="button" aria-pressed={panelOpen && !resourceKind && (botConversationOpen?botPanelView==="check":panelView === "check") } onClick={() => botConversationOpen?openBotPanel("check"):openPanel("check")}>检查</button>
            </nav>
            {panelOpen && <button className="main-toolbar__close" aria-label="关闭右侧面板" onClick={() => setPanelOpen(false)}><X size={15} /></button>}
          </div>
        </div>
        <div className="main-canvas">
          {botHomeId&&botOverview?.bots.find(b=>b.id===botHomeId&&b.status!=="archived") ? <BotHome key={botHomeId} bot={botOverview.bots.find(b=>b.id===botHomeId)!} projects={state.projects} agents={state.agents} onRefresh={reloadBots} onConversation={selectBotConversation}/> : botConversationOpen ? (
            <BotConversationView state={botConversation} projects={state.projects} onRole={selectBotParticipant} onManage={()=>openBotPanel("sessions")} onReviewAgentIssue={reviewAgentIssue}/>
          ) : selectedProject ? (
            <ProjectSessionView project={selectedProject} session={projectSession} botParent={projectSessionParent?{title:projectSessionParent.conversationTitle,onReturn:()=>{closeSessionDisplays();setSelection({kind:'bot-conversation',botId:projectSessionParent.botId,conversationId:projectSessionParent.conversationId});}}:undefined} />
          ) : (
            <main className="surface">
              <div className="empty-state">
                <h1>{state.loading ? "正在加载项目…" : state.error || "暂无项目"}</h1>
                {!state.loading && <p>从左侧创建项目或 Bot。</p>}
              </div>
            </main>
          )}
        </div>
      </section>

      {filePreview && (selectedProject || botConversation.detail) && (
        <FilePreviewPane
          projectName={botConversationOpen?botConversation.detail!.bot.name:selectedProject!.name}
          rootPath={botConversationOpen?botConversation.detail!.bot.workingDirectory:selectedProject!.rootPath}
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
      <RoleDirectory open={rolesOpen&&!roleEditorTarget} roles={state.agents} onRefresh={state.reload} onClose={()=>setRolesOpen(false)} onEdit={target=>{setRolesOpen(false);setRoleEditorTarget(target);}}/>

      {panelOpen && botConversationOpen && botConversation.detail&&!roleEditorTarget && <BotPanel detail={botConversation.detail} view={botPanelView} projects={state.projects} onClose={()=>setPanelOpen(false)} onRefresh={async()=>{await botConversation.refresh();await reloadBots();}} onRole={selectBotParticipant} onOpenFile={setFilePreview}/>}
      {botCreate&&<BotCreateDialog botId={typeof botCreate==="string"?botCreate:undefined} projects={state.projects} agents={state.agents} onClose={()=>setBotCreate(null)} onSaved={id=>{void reloadBots();setSelection(typeof botCreate==="string"?{kind:'bot-conversation',botId:botCreate,conversationId:id}:{kind:'bot',botId:id});}}/>}
      {panelOpen && !botConversationOpen && <ContextPanel
        visible={panelOpen&&!roleEditorTarget}
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
      {sessionProjectId&&<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true"><header><h2>选择项目角色</h2><button onClick={()=>setSessionProjectId(null)}>关闭</button></header><RoleSelector kind="project" projectId={sessionProjectId} projects={state.projects} value={sessionRoleId} onChange={setSessionRoleId}/><footer><button disabled={!sessionRoleId||!!creatingSessionProjectId} onClick={()=>{const id=sessionProjectId;void createProjectSession(id,{...sessionCreateBody,agentId:sessionRoleId});}}>创建项目会话</button></footer></section></div>}
      {state.error && <button className="error-banner" onClick={() => state.setError("")}>{state.error}<Trash2 size={13} /></button>}
    </div>
  );
}
