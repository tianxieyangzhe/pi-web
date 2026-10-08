import {useState} from "react";
import {api} from "../../api/client";
import {SessionMemoryPanel} from "./session-memory-panel";
import { Plus, X } from "lucide-react";
import type { Agent, FilePreview, Mcp, Project } from "../../domain/models";
import { useProjectSession } from "../conversation/project-session/use-project-session";
import { FileBrowser } from "../files/file-browser";
import { AgentMcpForm } from "./agent-mcp-form";
import { ProjectSessionInspector } from "./project-session-inspector";

type ResourceKind = "project" | "agent" | "mcp";

export function ContextPanel({ visible, panelView, selectedProject, session, resourceKind, resourceId, selectedResource, projects, agents, mcps, onClose, onOpenFile, onOpenResource, onSaveResource, onDeleteResource }: {
  visible:boolean;
  panelView: "memory" | "files" | "check";
  selectedProject: Project | null;
  session: ReturnType<typeof useProjectSession>;
  resourceKind: ResourceKind | null;
  resourceId: string | null;
  selectedResource: Agent | Mcp | null;
  projects: Project[];
  agents: Agent[];
  mcps: Mcp[];
  onClose: () => void;
  onOpenFile: (preview: FilePreview) => void;
  onOpenResource: (kind: ResourceKind, id?: string) => void;
  onSaveResource: (kind: "agent" | "mcp", id: string | null, body: Record<string, unknown>) => void;
  onDeleteResource: (kind: "agent" | "mcp", id: string) => void;
}) {
  const [headerActionsTarget,setHeaderActionsTarget]=useState<HTMLDivElement|null>(null);
  const fileBrowserOpen = panelView === "files";
  const memoryOpen = panelView === "memory" && !resourceKind;
  const panelTitle = fileBrowserOpen ? "文件" : memoryOpen ? "记忆" : "检查";
  return <aside hidden={!visible} className="context-panel" aria-label={`${panelTitle}面板`}>
    <header className="context-panel__header">
      <b>{panelTitle}</b>
      <div className="context-panel__header-actions"><div ref={setHeaderActionsTarget}/><button className="context-panel__close" aria-label={`关闭${panelTitle}面板`} onClick={onClose}><X size={15} /></button></div>
    </header>
    {selectedProject&&<SessionMemoryPanel memory={session.memory} headerActionsTarget={headerActionsTarget} key={session.sessionId??selectedProject.id} projectId={selectedProject.id} sessionId={session.sessionId} running={session.running} visible={visible&&!fileBrowserOpen&&memoryOpen&&!resourceKind} onOpenOutput={(path)=>{void api.readFile(selectedProject.id,path).then(onOpenFile).catch(cause=>session.setError(cause instanceof Error?cause.message:"无法预览产出"));}}/>}
    {!fileBrowserOpen&&memoryOpen&&!resourceKind&&selectedProject ? null : fileBrowserOpen && selectedProject ? (
      <FileBrowser key={selectedProject.id} projectId={selectedProject.id} projectName={selectedProject.name} rootPath={selectedProject.rootPath} onOpenFile={onOpenFile} />
    ) : resourceKind && resourceKind !== "project" ? (
      <AgentMcpForm
        resource={selectedResource}
        onSave={(body) => onSaveResource(resourceKind, resourceId, body)}
        onDelete={resourceId ? () => onDeleteResource(resourceKind, resourceId) : undefined}
      />
    ) : visible && selectedProject ? (
      <ProjectSessionInspector project={selectedProject} session={session} />
    ) : (
      <ResourceIndex projects={projects} agents={agents} mcps={mcps} onOpen={onOpenResource} />
    )}
  </aside>;
}

function ResourceIndex({ projects, agents, mcps, onOpen }: {
  projects: Project[];
  agents: Agent[];
  mcps: Mcp[];
  onOpen: (kind: ResourceKind, id?: string) => void;
}) {
  return <div className="inspector__body">
    <ResourceList title="项目" kind="project" values={projects} onOpen={onOpen} />
    <ResourceList title="Agent" kind="agent" values={agents} onOpen={onOpen} />
    <ResourceList title="MCP" kind="mcp" values={mcps} onOpen={onOpen} />
  </div>;
}

function ResourceList({ title, kind, values, onOpen }: {
  title: string;
  kind: ResourceKind;
  values: Array<{ id: string; name: string }>;
  onOpen: (kind: ResourceKind, id?: string) => void;
}) {
  return <section className="resource-list">
    <div className="resource-list__heading">
      <b>{title}</b>
      <button aria-label={`新建${title}`} onClick={() => onOpen(kind)}><Plus size={13} /></button>
    </div>
    {values.map((item) => <button key={item.id} onClick={() => onOpen(kind, item.id)}>{item.name}</button>)}
  </section>;
}
