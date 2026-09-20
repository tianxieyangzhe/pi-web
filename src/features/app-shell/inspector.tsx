"use client";

import type { Agent, Mcp, Project, RoomContent, RoomContentKind, Session } from "@/domain/models";
import { ProjectFileTree, type ProjectFileTreeEntry } from "@/features/project";
import { HorizontalTabs } from "@/shared/ui/primitives/tabs";
import { FileCode2, FileText, FolderKanban, Network, Pencil, Plus, Settings2, X } from "lucide-react";

export type InspectorTab = "structure" | "content" | "projects" | "mcps" | "agents" | "details";

type InspectorProps = {
  tab: InspectorTab;
  sessions: Session[];
  contents: RoomContent[];
  projects: Project[];
  mcps: Mcp[];
  agents: Agent[];
  selectedSession: Session | null;
  projectFiles: ProjectFileTreeEntry[];
  filesLoading: boolean;
  selectedProjectId: string | null;
  activeFilePath: string | null;
  fileContentVisible: boolean;
  expandedPaths: Set<string>;
  onTabChange: (tab: InspectorTab) => void;
  onSelectProject: (project: Project) => void;
  onSelectFile: (entry: ProjectFileTreeEntry) => void;
  onExpandedChange: (paths: Set<string>) => void;
  onFolderToggle: (path: string, expanded: boolean) => void;
  onCreateResource: () => void;
  onEditResource: (kind: "project" | "mcp" | "agent", id: string) => void;
  onCreateContent: (kind: RoomContentKind) => void;
  onEditContent: (id: string) => void;
  onClose: () => void;
};

const tabs: Array<{ id: InspectorTab; label: string }> = [
  { id: "structure", label: "结构" },
  { id: "content", label: "内容" },
  { id: "projects", label: "项目" },
  { id: "mcps", label: "MCP" },
  { id: "agents", label: "Agent" },
  { id: "details", label: "详情" },
];

function Empty({ children }: { children: string }) {
  return <p className="mx-2 my-9 text-center text-xs text-slate-400">{children}</p>;
}

export function Inspector({
  tab,
  sessions,
  contents,
  projects,
  mcps,
  agents,
  selectedSession,
  projectFiles,
  filesLoading,
  selectedProjectId,
  activeFilePath,
  fileContentVisible,
  expandedPaths,
  onTabChange,
  onSelectProject,
  onSelectFile,
  onExpandedChange,
  onFolderToggle,
  onCreateResource,
  onEditResource,
  onCreateContent,
  onEditContent,
  onClose,
}: InspectorProps) {
  return (
    <aside className={`fixed inset-y-0 right-0 z-[60] flex w-[min(400px,calc(100vw-48px))] min-w-0 flex-col border-l border-slate-200 bg-white shadow-2xl shadow-slate-900/10 xl:static xl:z-auto xl:row-start-1 xl:w-auto xl:shadow-none ${fileContentVisible ? "xl:col-start-4" : "xl:col-start-3"}`} aria-label="检查栏">
      <header className="flex min-h-[68px] items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">ROOM STRUCTURE</span>
          <h2 className="mt-0.5 text-base font-bold text-slate-800">检查栏</h2>
        </div>
        <button className="grid size-[34px] place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="隐藏检查栏" title="隐藏检查栏" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <HorizontalTabs value={tab} options={tabs} label="检查栏选项" onChange={onTabChange} />
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "structure" && <Structure sessions={sessions} />}
        {tab === "content" && <Content contents={contents} sessions={sessions} onCreate={onCreateContent} onEdit={onEditContent} />}
        {tab === "projects" && (
          <Projects
            projects={projects}
            sessions={sessions}
            selectedProjectId={selectedProjectId}
            activeFilePath={activeFilePath}
            projectFiles={projectFiles}
            filesLoading={filesLoading}
            expandedPaths={expandedPaths}
            onSelectProject={onSelectProject}
            onSelectFile={onSelectFile}
            onExpandedChange={onExpandedChange}
            onFolderToggle={onFolderToggle}
            onCreate={onCreateResource}
            onEdit={onEditResource}
          />
        )}
        {tab === "mcps" && <ResourceList kind="mcp" items={mcps} sessions={sessions} onCreate={onCreateResource} onEdit={onEditResource} />}
        {tab === "agents" && <ResourceList kind="agent" items={agents} sessions={sessions} onCreate={onCreateResource} onEdit={onEditResource} />}
        {tab === "details" && <Details session={selectedSession} projects={projects} />}
      </div>
    </aside>
  );
}

function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="text-sm font-bold text-slate-800">{title}</h3>
      {action && onAction && <button className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-2 text-[11px] font-bold text-teal-800 hover:bg-teal-100" onClick={onAction}><Plus size={13} />{action}</button>}
    </div>
  );
}

function Structure({ sessions }: { sessions: Session[] }) {
  return <section className="p-5"><SectionHeader title="工作线" /><div className="mb-5 grid grid-cols-3 gap-2"><div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><strong className="block text-xl text-slate-800">{sessions.length}</strong><span className="block text-[10px] text-slate-500">总数</span></div><div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><strong className="block text-xl text-slate-800">{sessions.filter((session) => session.state === "running").length}</strong><span className="block text-[10px] text-slate-500">运行中</span></div><div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><strong className="block text-xl text-slate-800">{sessions.filter((session) => session.role === "worker").length}</strong><span className="block text-[10px] text-slate-500">辅助</span></div></div>{sessions.length ? sessions.map((session) => <div className="flex min-h-[52px] items-center gap-2 border-t border-slate-100" key={session.id}><span className={`size-2 rounded-full ${session.state === "running" ? "bg-teal-600" : "bg-slate-400"}`} /><div className="min-w-0 flex-1"><b className="block truncate text-xs text-slate-800">{session.role === "primary" ? "主工作线" : session.purpose || "辅助工作线"}</b><small className="mt-0.5 block truncate text-[10px] text-slate-500">{session.agentSnapshot?.name ?? "Pi 基础能力"} · {session.state}</small></div></div>) : <Empty>尚未创建工作线</Empty>}</section>;
}

function Content({ contents, sessions, onCreate, onEdit }: { contents: RoomContent[]; sessions: Session[]; onCreate: (kind: RoomContentKind) => void; onEdit: (id: string) => void }) {
  const groups: Array<{ kind: RoomContentKind; title: string; empty: string }> = [
    { kind: "overview", title: "总览", empty: "尚未形成总览" },
    { kind: "goal", title: "目标", empty: "尚未形成目标" },
    { kind: "direction", title: "方向", empty: "尚未记录方向" },
    { kind: "output", title: "输出", empty: "尚未沉淀输出" },
  ];
  return <section className="grid gap-5 p-5">{groups.map((group) => {
    const items = contents.filter((item) => item.kind === group.kind);
    return <div className="min-w-0 border-t border-slate-100 pt-4 first:border-t-0 first:pt-0" key={group.kind}><SectionHeader title={group.title} action="新增" onAction={() => onCreate(group.kind)} />{items.length ? items.map((item) => {
      const source = item.sourceSessionId
        ? sessions.find((session) => session.id === item.sourceSessionId)
        : null;
      return <article className="flex items-start gap-2 border-t border-slate-100 py-3" key={item.id}><div className="min-w-0 flex-1"><span className="block text-[10px] text-slate-500">{item.status}{item.outputKind ? ` · ${item.outputKind}` : ""}</span><b className="mt-0.5 block text-xs text-slate-800">{item.title}</b><p className="mt-1 text-[11px] leading-5 text-slate-600">{item.body}</p><small className="mt-1.5 block text-[10px] text-slate-400">来源：{source ? sessionName(source) : "手工记录"}</small></div><button className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label={`编辑 ${item.title}`} onClick={() => onEdit(item.id)}><Pencil size={13} /></button></article>;
    }) : <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-center text-[11px] text-slate-400">{group.empty}</p>}</div>;
  })}</section>;
}

function sessionName(session: Session) {
  return session.role === "primary" ? "主工作线" : session.purpose || "辅助工作线";
}

function Projects({ projects, sessions, selectedProjectId, activeFilePath, projectFiles, filesLoading, expandedPaths, onSelectProject, onSelectFile, onExpandedChange, onFolderToggle, onCreate, onEdit }: { projects: Project[]; sessions: Session[]; selectedProjectId: string | null; activeFilePath: string | null; projectFiles: ProjectFileTreeEntry[]; filesLoading: boolean; expandedPaths: Set<string>; onSelectProject: (project: Project) => void; onSelectFile: (entry: ProjectFileTreeEntry) => void; onExpandedChange: (paths: Set<string>) => void; onFolderToggle: (path: string, expanded: boolean) => void; onCreate: () => void; onEdit: (kind: "project" | "mcp" | "agent", id: string) => void }) {
  const selected = projects.find((project) => project.id === selectedProjectId) ?? null;
  return <section className="p-5"><SectionHeader title="项目" action="新增" onAction={onCreate} />{projects.length === 0 ? <Empty>还没有项目</Empty> : <div className="grid gap-1">{projects.map((project) => {
    const working = sessions.filter((session) => session.workingProjectId === project.id).map(sessionName);
    const references = sessions.filter((session) => session.referenceProjectIds.includes(project.id)).map(sessionName);
    const usage = [...working.map((name) => `${name} 工作`), ...references.map((name) => `${name} 参考`)];
    return <div key={project.id} className={`flex min-h-[52px] items-center gap-2 rounded-lg px-2 ${selected?.id === project.id ? "bg-teal-50 ring-1 ring-teal-200" : "hover:bg-slate-50"}`}><button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => onSelectProject(project)}><FolderKanban size={16} /><span className="min-w-0 flex-1"><b className="block truncate text-xs text-slate-800">{project.name}</b><small className="mt-0.5 block truncate text-[10px] text-slate-500">{usage.length ? usage.join(" · ") : `${project.kind} · ${project.accessMode} · 当前会话未使用`}</small></span></button><button className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-white" aria-label={`编辑 ${project.name}`} onClick={() => onEdit("project", project.id)}><Settings2 size={14} /></button></div>;
  })}</div>}{selected && <div className="mt-4 border-t border-slate-200 pt-3"><div className="mb-2 flex justify-between text-[11px] text-slate-600"><span>{selected.name} 文件树</span><small className="text-slate-400">{projectFiles.length} 项</small></div>{filesLoading ? <Empty>正在读取文件树</Empty> : projectFiles.length ? <ProjectFileTree entries={projectFiles} expanded={expandedPaths} selectedPath={activeFilePath ?? undefined} onExpandedChange={onExpandedChange} onFolderToggle={onFolderToggle} onSelect={onSelectFile} renderFileIcon={(entry) => entry.type === "directory" ? <FolderKanban size={14} /> : entry.name.includes(".") ? <FileCode2 size={14} /> : <FileText size={14} />} /> : <Empty>项目目录为空</Empty>}</div>}</section>;
}

function ResourceList({ kind, items, sessions, onCreate, onEdit }: { kind: "mcp" | "agent"; items: Array<Mcp | Agent>; sessions: Session[]; onCreate: () => void; onEdit: (kind: "project" | "mcp" | "agent", id: string) => void }) {
  return <section className="p-5"><SectionHeader title={kind === "mcp" ? "MCP" : "Agent"} action="新增" onAction={onCreate} />{items.length === 0 ? <Empty>{kind === "mcp" ? "还没有 MCP" : "还没有 Agent"}</Empty> : items.map((item) => {
    const usedBy = sessions.filter((session) => kind === "mcp" ? session.mcpIds.includes(item.id) : session.agentId === item.id).map(sessionName);
    const detail = kind === "mcp" ? (item as Mcp).config.kind : (item as Agent).description || "Pi 扩展模板";
    return <div className="flex min-h-[52px] items-center gap-2 border-t border-slate-100" key={item.id}><Network className="text-slate-500" size={15} /><div className="min-w-0 flex-1"><b className="block truncate text-xs text-slate-800">{item.name}</b><small className="mt-0.5 block truncate text-[10px] text-slate-500">{usedBy.length ? `${usedBy.join("、")} · ${detail}` : `当前会话未使用 · ${detail}`}</small></div><button className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label={`编辑 ${item.name}`} onClick={() => onEdit(kind, item.id)}><Settings2 size={14} /></button></div>;
  })}</section>;
}

function Details({ session, projects }: { session: Session | null; projects: Project[] }) {
  if (!session) return <section className="p-5"><SectionHeader title="详情" /><Empty>选择一条工作线查看详情</Empty></section>;
  const projectName = (id: string) => projects.find((project) => project.id === id)?.name ?? "项目不可用";
  const references = session.referenceProjectIds.length
    ? session.referenceProjectIds.map(projectName).join("、")
    : "无";
  return <section className="p-5"><SectionHeader title="当前工作线" /><dl className="m-0 [&>div]:grid [&>div]:grid-cols-[96px_1fr] [&>div]:gap-2 [&>div]:border-t [&>div]:border-slate-100 [&>div]:py-2.5 [&_dd]:m-0 [&_dd]:break-words [&_dd]:text-[11px] [&_dd]:text-slate-800 [&_dt]:text-[11px] [&_dt]:text-slate-500"><div><dt>角色</dt><dd>{session.role === "primary" ? "主工作线" : "辅助工作线"}</dd></div><div><dt>状态</dt><dd>{session.state}</dd></div><div><dt>目的</dt><dd>{session.purpose ?? "默认工作线"}</dd></div><div><dt>Agent</dt><dd>{session.agentSnapshot?.name ?? "Pi 基础能力"}</dd></div><div><dt>MCP</dt><dd>{session.mcpIds.length} 个</dd></div><div><dt>工作项目</dt><dd>{session.workingProjectId ? projectName(session.workingProjectId) : "未绑定"}</dd></div><div><dt>参考项目</dt><dd>{references}</dd></div><div><dt>配置版本</dt><dd>{session.configurationRevision}</dd></div></dl></section>;
}
