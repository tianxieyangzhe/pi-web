"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArchiveRestore, Bot, Boxes, ChevronDown, ChevronRight, FileCode2, FolderOpen, FolderTree, Network, PanelRightClose, PanelRightOpen, Pencil, Plus, Search, Send, SlidersHorizontal, Trash2, Wrench, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { RuntimeTrace } from "@/lib/runtimes/runtime-types";

type Workspace = { id: string; name: string; workingDirectory: string };
type Room = { id: string; workspaceId: string; title: string; problemStatement?: string | null; summary?: string | null; projectIds: string[]; mcpIds: string[]; agentIds: string[]; runtimeId: string; activeAgentId: string; status: "active" | "paused" | "closed" | "archived"; sessions: { id: string; state: string }[] };
type SessionMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string; traces?: RuntimeTrace[] };
type Session = { id: string; title: string; status: "idle" | "ready" | "running" | "error"; messages: SessionMessage[] };
type InspectorKind = "projects" | "mcp" | "agents";
type FileEntry = { path: string; parentPath: string; name: string; type: "file" | "directory" };
type WorkspaceObject = { id: string; name: string; detail: string; status: string };
type ResourceDraft = { id?: string; name: string; kind?: string; localPath?: string; accessMode?: string; transport?: string; roleKind?: string; instruction?: string };
type FileChanges = { summary: string; diff: string };

const inspectorMeta: Record<InspectorKind, { label: string; icon: typeof FolderTree; description: string }> = {
  projects: { label: "项目", icon: FolderTree, description: "选择项目后，在此处查看它的文件树；当前 Room 不会消失。" },
  mcp: { label: "MCP", icon: Network, description: "Workspace 中可供 Pi Session 使用的 MCP 能力。" },
  agents: { label: "Agent", icon: Bot, description: "Workspace 级 Agent 角色；当前版本统一绑定 Pi Runtime。" },
};

function titleFromMessage(message: string) { const text = message.replace(/\s+/g, " ").trim(); return text.length > 30 ? `${text.slice(0, 30)}…` : text || "新建 Room"; }

function TracePanel({ traces, live = false }: { traces: RuntimeTrace[]; live?: boolean }) {
  return <section className="rw-runtime-trace"><header><span>运行过程</span><small>{live ? "实时更新" : "历史记录"}</small></header>{traces.map((trace) => <details className={`rw-trace ${trace.kind} ${trace.status}`} key={trace.id} open={live && trace.status === "running"}><summary><span>{trace.kind === "thinking" ? "思考" : trace.kind === "tool" ? "执行" : "上下文"}</span><b>{trace.summary}</b><i>{trace.status === "running" ? "进行中" : trace.status === "error" ? "失败" : "完成"}</i></summary>{trace.detail && <pre>{trace.detail}</pre>}</details>)}</section>;
}

function MessageContent({ content, markdown }: { content: string; markdown: boolean }) {
  return markdown ? <div className="rw-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div> : <div>{content}</div>;
}

function splitGitDiff(diff: string) {
  const parts = diff.split(/(?=^diff --git )/m).filter(Boolean);
  return parts.length ? parts.map((content, index) => {
    const match = /^diff --git a\/(.+?) b\/(.+)$/m.exec(content);
    const changedContent = content.split("\n").filter((line) => !(
      line.startsWith("diff --git ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("@@ ") ||
      line.startsWith("new file mode ") ||
      line.startsWith("deleted file mode ") ||
      line.startsWith("similarity index ") ||
      line.startsWith("rename from ") ||
      line.startsWith("rename to ")
    )).join("\n").trim();
    return { id: `${index}-${match?.[2] ?? match?.[1] ?? "change"}`, path: match?.[2] ?? match?.[1] ?? `未命名改动 ${index + 1}`, content: changedContent };
  }) : [{ id: "change", path: "工作区改动", content: diff }];
}

function FileChangesPanel({ changes }: { changes: FileChanges }) {
  const files = splitGitDiff(changes.diff);
  return <section className="rw-file-changes"><header><span>文件改动</span><b>{changes.summary}</b><i>{files.length} 个文件</i></header><div>{files.map((file) => <details key={file.id}><summary><span>{file.path}</span><i>查看改动</i></summary><pre>{file.content || "没有可展示的文本改动"}</pre></details>)}</div></section>;
}

export default function RoomWorkspaceClient() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoomId, setActiveRoomId] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [message, setMessage] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [runtimeTraces, setRuntimeTraces] = useState<RuntimeTrace[]>([]);
  const [fileChanges, setFileChanges] = useState<FileChanges | null>(null);
  const [inspector, setInspector] = useState<InspectorKind>("projects");
  const [rightVisible, setRightVisible] = useState(true);
  const [inspectorObjects, setInspectorObjects] = useState<WorkspaceObject[]>([]);
  const [inspectedProject, setInspectedProject] = useState<WorkspaceObject | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openFiles, setOpenFiles] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState("");
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [confirmingWorkspaceDelete, setConfirmingWorkspaceDelete] = useState(false);
  const [resourceDraft, setResourceDraft] = useState<ResourceDraft | null>(null);
  const [resourceError, setResourceError] = useState("");
  const [roomDraft, setRoomDraft] = useState<{ title: string; problemStatement: string; projectIds: string[]; mcpIds: string[]; agentIds: string[]; activeAgentId: string } | null>(null);
  const [roomOptions, setRoomOptions] = useState<{ projects: WorkspaceObject[]; mcp: WorkspaceObject[]; agents: WorkspaceObject[] }>({ projects: [], mcp: [], agents: [] });
  const [roomError, setRoomError] = useState("");
  const timelineRef = useRef<HTMLDivElement>(null);
  const activeRoom = rooms.find((room) => room.id === activeRoomId);
  const visibleRooms = rooms.filter((room) => room.status !== "archived");
  const archivedRooms = rooms.filter((room) => room.status === "archived");
  const activeRoomBelongsToWorkspace = activeRoom?.workspaceId === workspaceId;

  const activeSessionId = activeRoom?.sessions[0]?.id;
  const rightItem = inspectorMeta[inspector];

  useEffect(() => { void loadWorkspaces(); }, []);
  useEffect(() => { if (workspaceId) void loadRooms(workspaceId); }, [workspaceId]);
  useEffect(() => { if (workspaceId) void loadInspector(workspaceId, inspector); }, [workspaceId, inspector]);
  useEffect(() => { if (activeSessionId) void loadSession(activeSessionId); else setSession(null); }, [activeSessionId]);
  useEffect(() => {
    const timeline = timelineRef.current;
    if (timeline) timeline.scrollTop = timeline.scrollHeight;
  }, [streamingText, runtimeTraces, session?.messages.length, session?.status]);

  async function loadWorkspaces() {
    const response = await fetch("/api/workspaces");
    if (!response.ok) return;
    const data = await response.json() as { workspaces: Workspace[] };
    setWorkspaces(data.workspaces);
    setWorkspaceId(data.workspaces.find((item) => item.name === "langgraph-app")?.id ?? data.workspaces[0]?.id ?? "");
  }

  async function createWorkspace() {
    const name = workspaceName.trim();
    if (!name) { setWorkspaceError("请输入工作空间名称"); return; }
    setWorkspaceError("");
    const response = await fetch("/api/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    if (!response.ok) {
      const result = await response.json().catch(() => ({ error: "创建工作空间失败" })) as { error?: string };
      setWorkspaceError(result.error ?? "创建工作空间失败");
      return;
    }
    const data = await response.json() as { workspace: Workspace };
    setWorkspaces((current) => [...current, data.workspace]);
    setWorkspaceId(data.workspace.id);
    setRooms([]);
    setActiveRoomId("");
    setSession(null);
    setInspectedProject(null);
    setWorkspaceName("");
    setCreatingWorkspace(false);
  }

  async function deleteCurrentWorkspace() {
    if (!workspaceId || workspaceId === "default") return;
    const response = await fetch(`/api/workspaces/${workspaceId}`, { method: "DELETE" });
    if (!response.ok) {
      const result = await response.json().catch(() => ({ error: "删除工作空间失败" })) as { error?: string };
      setWorkspaceError(result.error ?? "删除工作空间失败");
      return;
    }
    const remaining = workspaces.filter((workspace) => workspace.id !== workspaceId);
    setWorkspaces(remaining);
    setWorkspaceId(remaining[0]?.id ?? "");
    setRooms([]);
    setActiveRoomId("");
    setSession(null);
    setConfirmingWorkspaceDelete(false);
  }

  async function loadRooms(id: string) {
    const response = await fetch(`/api/workspaces/${id}/rooms`);
    if (!response.ok) return;
    const data = await response.json() as { rooms: Room[] };
    setRooms(data.rooms);
    setActiveRoomId((current) => data.rooms.some((room) => room.id === current && room.status !== "archived") ? current : data.rooms.find((room) => room.status !== "archived")?.id ?? "");
  }

  async function loadSession(id: string) {
    const response = await fetch(`/api/sessions/${id}`);
    if (!response.ok) return;
    const data = await response.json() as { session: Session };
    setSession(data.session);
  }

  async function loadInspector(id: string, kind: InspectorKind) {
    const response = await fetch(`/api/workspaces/${id}/objects?kind=${kind}`);
    if (!response.ok) return;
    const data = await response.json() as { objects: WorkspaceObject[] };
    setInspectorObjects(data.objects);
  }

  function inspect(kind: InspectorKind) {
    setInspector(kind);
    setInspectedProject(null);
    setResourceDraft(null);
    setResourceError("");
    setRightVisible(true);
  }

  const resourceKind = inspector === "projects" ? "project" : inspector === "mcp" ? "mcp" : "agent";
  function blankResource(): ResourceDraft { return inspector === "projects" ? { name: "", kind: "code", localPath: "", accessMode: "write" } : inspector === "mcp" ? { name: "", transport: "stdio" } : { name: "", roleKind: "system", instruction: "" }; }
  async function editResource(entry: WorkspaceObject) {
    const response = await fetch(`/api/workspaces/${workspaceId}/resources/${resourceKind}/${entry.id}`);
    if (!response.ok) return;
    const { resource } = await response.json() as { resource: Record<string, string | null> };
    setResourceDraft({ id: entry.id, name: resource.name ?? "", kind: resource.kind ?? "code", localPath: resource.localPath ?? "", accessMode: resource.accessMode ?? "write", transport: resource.transport ?? "stdio", roleKind: resource.roleKind ?? "system", instruction: resource.instruction ?? "" });
    setResourceError("");
  }
  async function saveResource() {
    if (!resourceDraft) return;
    const url = resourceDraft.id ? `/api/workspaces/${workspaceId}/resources/${resourceKind}/${resourceDraft.id}` : `/api/workspaces/${workspaceId}/resources/${resourceKind}`;
    const response = await fetch(url, { method: resourceDraft.id ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(resourceDraft) });
    if (!response.ok) { const data = await response.json().catch(() => ({ error: "保存失败" })) as { error?: string }; setResourceError(data.error ?? "保存失败"); return; }
    setResourceDraft(null); setResourceError(""); await loadInspector(workspaceId, inspector);
  }
  async function removeResource(id: string) {
    const response = await fetch(`/api/workspaces/${workspaceId}/resources/${resourceKind}/${id}`, { method: "DELETE" });
    if (!response.ok) { const data = await response.json().catch(() => ({ error: "删除失败" })) as { error?: string }; setResourceError(data.error ?? "删除失败"); return; }
    setResourceDraft(null); setInspectedProject(null); await loadInspector(workspaceId, inspector);
  }

  async function beginRoomCreation() {
    if (!workspaceId) return;
    const [projects, mcp, agents] = await Promise.all(["projects", "mcp", "agents"].map(async (kind) => {
      const response = await fetch(`/api/workspaces/${workspaceId}/objects?kind=${kind}`);
      return response.ok ? (await response.json() as { objects: WorkspaceObject[] }).objects : [];
    }));
    setRoomOptions({ projects, mcp, agents });
    setRoomDraft({ title: "", problemStatement: "", projectIds: [], mcpIds: [], agentIds: agents[0] ? [agents[0].id] : [], activeAgentId: agents[0]?.id ?? "" });
    setRoomError("");
  }
  function toggleRoomOption(field: "projectIds" | "mcpIds" | "agentIds", id: string) {
    if (!roomDraft) return;
    const values = roomDraft[field]; const next = values.includes(id) ? values.filter((item) => item !== id) : [...values, id];
    const activeAgentId = field === "agentIds" && roomDraft.activeAgentId === id && !next.includes(id) ? next[0] ?? "" : roomDraft.activeAgentId || (field === "agentIds" ? next[0] ?? "" : roomDraft.activeAgentId);
    setRoomDraft({ ...roomDraft, [field]: next, activeAgentId });
  }
  async function submitRoom() {
    if (!workspaceId || !roomDraft) return;
    if (!roomDraft.title.trim()) { setRoomError("请填写 Room 名称"); return; }
    if (!roomDraft.agentIds.length || !roomDraft.activeAgentId) { setRoomError("Room 至少需要一个 Agent"); return; }
    const response = await fetch(`/api/workspaces/${workspaceId}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(roomDraft) });
    if (!response.ok) { const result = await response.json().catch(() => ({ error: "创建 Room 失败" })) as { error?: string }; setRoomError(result.error ?? "创建 Room 失败"); return; }
    const data = await response.json() as { room: Room };
    setRooms((current) => [data.room, ...current]); setActiveRoomId(data.room.id); setRoomDraft(null);
  }

  function createRoom() { void beginRoomCreation(); }

  function switchWorkspace(nextWorkspaceId: string) {
    // Clear every Workspace-scoped view synchronously. Without this, a fast
    // send after changing the selector can dispatch to the previous Room.
    setWorkspaceId(nextWorkspaceId);
    setRooms([]);
    setActiveRoomId("");
    setSession(null);
    setMessage("");
    setStreamingText("");
    setRuntimeTraces([]);
    setFileChanges(null);
    setInspectedProject(null);
    setFiles([]);
    setOpenFiles({});
    setActiveFile("");
    setConfirmingWorkspaceDelete(false);
  }

  async function setRoomArchiveState(room: Room, archived: boolean) {
    const response = await fetch(`/api/rooms/${room.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: archived ? "archived" : "active" }) });
    if (!response.ok) { setRoomError("无法更新 Room 状态"); return; }
    const { room: updated } = await response.json() as { room: Room };
    setRooms((current) => current.map((item) => item.id === updated.id ? updated : item));
    if (archived && activeRoomId === room.id) setActiveRoomId(visibleRooms.find((item) => item.id !== room.id)?.id ?? "");
    if (!archived) setActiveRoomId(room.id);
  }

  async function removeRoom(room: Room) {
    if (!window.confirm(`删除「${room.title}」？此操作会移除 Room 及其应用内运行时会话，Pi 原生历史文件仍会保留。`)) return;
    const response = await fetch(`/api/rooms/${room.id}`, { method: "DELETE" });
    if (!response.ok) { setRoomError("无法删除 Room"); return; }
    const remaining = rooms.filter((item) => item.id !== room.id);
    setRooms(remaining);
    if (activeRoomId === room.id) setActiveRoomId(remaining.find((item) => item.status !== "archived")?.id ?? "");
  }

  async function send() {
    const content = message.trim();
    if (!content || !activeRoom || !activeRoomBelongsToWorkspace || session?.status === "running") return;
    const userMessage: SessionMessage = { id: crypto.randomUUID(), role: "user", content, createdAt: new Date().toISOString() };
    setMessage(""); setStreamingText("");
    setRuntimeTraces([]);
    setFileChanges(null);
    setSession((current) => current ? { ...current, title: current.messages.length === 0 ? titleFromMessage(content) : current.title, status: "running", messages: [...current.messages, userMessage] } : current);
    try {
      const response = await fetch(`/api/rooms/${activeRoom.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: content }) });
      if (!response.ok || !response.body) {
        const result = await response.json().catch(() => ({ error: "Pi Runtime 未能开始本次执行" })) as { error?: string };
        throw new Error(result.error ?? "Pi Runtime 未能开始本次执行");
      }
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffered = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffered += decoder.decode(value, { stream: true }); const lines = buffered.split("\n"); buffered = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const event = JSON.parse(line) as { type: string; text?: string; message?: string; room?: Room; id?: string; kind?: RuntimeTrace["kind"]; status?: RuntimeTrace["status"]; summary?: string; detail?: string; diff?: string };
          if (event.type === "text") setStreamingText(event.text ?? "");
          if (event.type === "trace" && event.id && event.kind && event.status && event.summary) {
            const trace: RuntimeTrace = { id: event.id, kind: event.kind, status: event.status, summary: event.summary, detail: event.detail };
            setRuntimeTraces((current) => {
              const index = current.findIndex((item) => item.id === trace.id);
              return index < 0 ? [...current, trace] : current.map((item, itemIndex) => itemIndex === index ? { ...item, ...trace, detail: trace.detail || item.detail } : item);
            });
          }
          if (event.type === "file_changes" && event.summary && event.diff) setFileChanges({ summary: event.summary, diff: event.diff });
          if (event.type === "complete" && event.room) { setRooms((current) => current.map((room) => room.id === event.room!.id ? event.room! : room)); await loadSession(activeSessionId!); setStreamingText(""); setRuntimeTraces([]); }
          if (event.type === "error") { setStreamingText(event.message ?? "Pi Runtime 执行失败"); setSession((current) => current ? { ...current, status: "error" } : current); }
        }
      }
    } catch (error) { setStreamingText(error instanceof Error ? error.message : "无法连接 Pi Runtime"); setSession((current) => current ? { ...current, status: "error" } : current); }
  }

  async function openProject(project: WorkspaceObject) {
    setInspectedProject(project);
    const response = await fetch(`/api/workspaces/${workspaceId}/files?projectId=${encodeURIComponent(project.id)}&includeHidden=false`);
    if (response.ok) setFiles((await response.json() as { entries: FileEntry[] }).entries);
    else { const result = await response.json().catch(() => ({ error: "无法读取项目文件" })) as { error?: string }; setFiles([]); setResourceError(result.error ?? "无法读取项目文件"); }
  }

  async function openFile(path: string) {
    setActiveFile(path);
    if (openFiles[path] !== undefined) return;
    if (!inspectedProject) return;
    const response = await fetch(`/api/workspaces/${workspaceId}/files/content?projectId=${encodeURIComponent(inspectedProject.id)}&path=${encodeURIComponent(path)}`);
    const data = await response.json() as { content?: string };
    if (response.ok && data.content !== undefined) setOpenFiles((current) => ({ ...current, [path]: data.content! }));
  }

  const rootFiles = useMemo(() => files.filter((entry) => entry.parentPath === "").sort((a, b) => Number(b.type === "directory") - Number(a.type === "directory") || a.name.localeCompare(b.name)), [files]);
  function renderFiles(parent = "", depth = 0): React.ReactNode {
    return files.filter((entry) => entry.parentPath === parent).sort((a, b) => Number(b.type === "directory") - Number(a.type === "directory") || a.name.localeCompare(b.name)).map((entry) => {
      if (entry.type === "directory") { const isOpen = expanded.has(entry.path); return <div key={entry.path}><button className="rw-file-row" style={{ paddingLeft: 11 + depth * 15 }} onClick={() => setExpanded((current) => { const next = new Set(current); isOpen ? next.delete(entry.path) : next.add(entry.path); return next; })}>{isOpen ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}<span className="rw-folder">⌁</span>{entry.name}</button>{isOpen && renderFiles(entry.path, depth + 1)}</div>; }
      return <button key={entry.path} className={`rw-file-row rw-file ${activeFile === entry.path ? "open" : ""}`} style={{ paddingLeft: 33 + depth * 15 }} onClick={() => void openFile(entry.path)}><FileCode2 size={13}/>{entry.name}</button>;
    });
  }

  return <><main className={`room-workspace ${rightVisible ? "" : "right-hidden"} ${activeFile ? "preview-open" : ""} ${resourceDraft && inspector !== "projects" ? "resource-modal-open" : ""}`}>
    <header className="rw-topbar"><div className="rw-brand"><span>◇</span>AI as Workspace</div><label className="rw-workspace"><span>工作空间</span><select value={workspaceId} onChange={(event) => switchWorkspace(event.target.value)}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{creatingWorkspace ? <form className="rw-workspace-create" onSubmit={(event) => { event.preventDefault(); void createWorkspace(); }}><input autoFocus value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="工作空间名称" aria-label="工作空间名称"/><button type="submit">创建</button><button type="button" onClick={() => { setCreatingWorkspace(false); setWorkspaceName(""); setWorkspaceError(""); }}>取消</button>{workspaceError && <small>{workspaceError}</small>}</form> : <button className="rw-new-workspace" onClick={() => setCreatingWorkspace(true)}><Plus size={14}/> 新建工作空间</button>}{confirmingWorkspaceDelete ? <span className="rw-delete-confirm"><span>删除当前工作空间？</span><button onClick={() => void deleteCurrentWorkspace()}>删除</button><button onClick={() => setConfirmingWorkspaceDelete(false)}>取消</button></span> : <button className="rw-delete-workspace" disabled={workspaceId === "default"} title={workspaceId === "default" ? "默认工作空间不可删除" : "删除当前工作空间"} onClick={() => setConfirmingWorkspaceDelete(true)}><Trash2 size={14}/> 删除</button>}<button className="rw-right-toggle" onClick={() => setRightVisible((current) => !current)}>{rightVisible ? <PanelRightClose size={15}/> : <PanelRightOpen size={15}/>} {rightVisible ? "隐藏右栏" : "显示右栏"}</button></header>
    <aside className="rw-left"><button className="rw-new-room" onClick={() => void createRoom()}><Plus size={15}/> 新建 Room</button><div className="rw-tree-label">{workspaces.find((item) => item.id === workspaceId)?.name ?? "工作空间"}</div><div className="rw-object-entry"><button onClick={() => inspect("projects")}><FolderTree size={15}/>项目</button><button onClick={() => inspect("mcp")}><Network size={15}/>MCP</button><button onClick={() => inspect("agents")}><Bot size={15}/>Agent</button></div><div className="rw-tree-rule"/><div className="rw-rooms">{visibleRooms.map((room) => <div className={`rw-room-row ${room.id === activeRoomId ? "active" : ""}`} key={room.id}><button className="rw-room" onClick={() => setActiveRoomId(room.id)}><span>{room.id === activeRoomId ? "●" : "○"}</span><span>{room.title}</span>{room.status === "active" && <i/>}</button><span className="rw-room-actions"><button title="归档 Room" aria-label={`归档 ${room.title}`} onClick={() => void setRoomArchiveState(room, true)}><Archive size={13}/></button><button title="删除 Room" aria-label={`删除 ${room.title}`} onClick={() => void removeRoom(room)}><Trash2 size={13}/></button></span></div>)}{visibleRooms.length === 0 && <p>还没有活跃 Room</p>}{archivedRooms.length > 0 && <><div className="rw-archived-label">已归档</div>{archivedRooms.map((room) => <div className="rw-room-row archived" key={room.id}><button className="rw-room" onClick={() => setActiveRoomId(room.id)}><span>○</span><span>{room.title}</span></button><span className="rw-room-actions"><button title="恢复 Room" aria-label={`恢复 ${room.title}`} onClick={() => void setRoomArchiveState(room, false)}><ArchiveRestore size={13}/></button><button title="删除 Room" aria-label={`删除 ${room.title}`} onClick={() => void removeRoom(room)}><Trash2 size={13}/></button></span></div>)}</>}</div></aside>
    <section className="rw-stage">
      <div className="rw-room-head"><div className="rw-crumb">{workspaces.find((item) => item.id === workspaceId)?.name ?? "Workspace"} / 当前 Room</div><div className="rw-room-title"><h1>{activeRoom?.title ?? "新建 Room"}</h1><span>{session?.status === "running" ? "Pi 执行中" : "Pi 已就绪"}</span></div><div className="rw-room-scope"><span>当前原生 Session</span><button><Bot size={13}/> Pi Agent</button><button><Wrench size={13}/> 工作目录</button></div></div>
      <div className="rw-session-strip"><div className="rw-session"><span className="rw-avatar">π</span><div><b>Pi Agent</b><small>{session?.status === "running" ? "正在使用原生 Session" : "Room 主 Session"}</small></div></div><button className="rw-session-detail"><SlidersHorizontal size={14}/> Session 状态</button></div>
      <div className="rw-timeline" ref={timelineRef}>
        {session?.messages.map((item) => <div key={item.id}>
          {item.role === "assistant" && item.traces?.length ? <TracePanel traces={item.traces}/> : null}
          <article className={`rw-message ${item.role}`}>
            <div className="rw-message-meta"><b>{item.role === "user" ? "你" : "Pi Agent"}</b><span>{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
            <MessageContent content={item.content} markdown={item.role === "assistant"}/>
          </article>
        </div>)}
        {runtimeTraces.length > 0 && <TracePanel traces={runtimeTraces} live/>}
        {streamingText && <article className="rw-message assistant streaming"><div className="rw-message-meta"><b>Pi Agent</b><span>实时输出</span></div><MessageContent content={streamingText} markdown/></article>}
        {fileChanges && <FileChangesPanel changes={fileChanges}/>}
        {!session?.messages.length && !streamingText && runtimeTraces.length === 0 && <div className="rw-empty"><Boxes size={28}/><h2>开始一个 Room</h2><p>第一条消息会创建 Pi 的原生会话。项目配置、Skills、扩展和 AGENTS.md 由 Pi 在工作目录中自行发现。</p></div>}
      </div>
      <div className="rw-composer"><textarea placeholder={activeRoomBelongsToWorkspace ? "继续当前 Room…" : "正在加载当前工作空间的 Room…"} value={message} disabled={!activeRoomBelongsToWorkspace} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}/><div><span>@ Pi Agent</span><span># 添加资源或资产</span><button onClick={() => void send()} disabled={!activeRoomBelongsToWorkspace || !message.trim() || session?.status === "running"}><Send size={14}/>发送</button></div></div>
    </section>
    {activeFile && <section className="rw-preview"><div className="rw-file-tabs">{Object.keys(openFiles).map((path) => <button className={path === activeFile ? "active" : ""} key={path} onClick={() => setActiveFile(path)}><FileCode2 size={13}/>{path.split("/").at(-1)}<X size={13} onClick={(event) => { event.stopPropagation(); setOpenFiles((current) => { const { [path]: _closed, ...rest } = current; return rest; }); setActiveFile((current) => current === path ? Object.keys(openFiles).filter((item) => item !== path).at(-1) ?? "" : current); }}/></button>)}</div><div className="rw-file-path">{activeFile}</div><pre>{(openFiles[activeFile] ?? "正在读取文件…").split("\n").map((line, index) => <code key={`${index}-${line}`}><i>{index + 1}</i><span>{line || " "}</span></code>)}</pre></section>}
    <aside className="rw-inspector">{inspectedProject ? <><div className="rw-inspector-head"><div><h2>{inspectedProject.name}</h2><p>文件树只在查看项目时出现；Room 保持在中间主舞台。</p></div><button aria-label="返回项目列表" onClick={() => setInspectedProject(null)}><X size={15}/></button></div><div className="rw-file-search"><Search size={13}/>筛选文件…</div><div className="rw-file-tree">{rootFiles.length ? renderFiles() : <p>正在读取项目文件…</p>}</div></> : <><div className="rw-inspector-head"><div><h2>{resourceDraft ? `${resourceDraft.id ? "编辑" : "新建"}${rightItem.label}` : rightItem.label}</h2><p>{resourceDraft ? "修改后会立即保存到当前 Workspace。" : rightItem.description}</p></div>{!resourceDraft && <button aria-label={`新建${rightItem.label}`} onClick={() => setResourceDraft(blankResource())}><Plus size={15}/></button>}</div>{resourceDraft ? <div className="rw-resource-form"><label>名称<input value={resourceDraft.name} onChange={(event) => setResourceDraft({ ...resourceDraft, name: event.target.value })}/></label>{inspector === "projects" && <><label>类型<select value={resourceDraft.kind} onChange={(event) => setResourceDraft({ ...resourceDraft, kind: event.target.value })}><option value="code">代码项目</option><option value="knowledge">知识库</option></select></label><label>本地路径<input value={resourceDraft.localPath} onChange={(event) => setResourceDraft({ ...resourceDraft, localPath: event.target.value })} placeholder="/absolute/path"/></label><label>权限<select value={resourceDraft.accessMode} onChange={(event) => setResourceDraft({ ...resourceDraft, accessMode: event.target.value })}><option value="write">读写</option><option value="read">只读</option></select></label></>}{inspector === "mcp" && <label>传输<select value={resourceDraft.transport} onChange={(event) => setResourceDraft({ ...resourceDraft, transport: event.target.value })}><option value="stdio">stdio</option><option value="sse">SSE</option><option value="streamable_http">Streamable HTTP</option><option value="in_process">In process</option></select></label>}{inspector === "agents" && <><label>角色<select value={resourceDraft.roleKind} onChange={(event) => setResourceDraft({ ...resourceDraft, roleKind: event.target.value })}><option value="system">系统</option><option value="project">项目</option><option value="specialist">专家</option><option value="reviewer">审查</option></select></label><label>默认 Runtime<input value="Pi（当前 Workspace 默认 Runtime）" readOnly/></label><label>稳定指令<textarea value={resourceDraft.instruction} onChange={(event) => setResourceDraft({ ...resourceDraft, instruction: event.target.value })}/></label></>} {resourceError && <p className="rw-resource-error">{resourceError}</p>}<div><button onClick={() => void saveResource()}>保存</button><button onClick={() => { setResourceDraft(null); setResourceError(""); }}>取消</button>{resourceDraft.id && <button className="danger" onClick={() => void removeResource(resourceDraft.id!)}><Trash2 size={13}/>删除</button>}</div></div> : <>{inspectorObjects.map((entry) => <div className="rw-inspector-entry" key={entry.id}><button className="rw-resource-open" onClick={() => inspector === "projects" ? void openProject(entry) : void editResource(entry)}><rightItem.icon size={16}/><span><b>{entry.name}</b><small>{entry.detail}</small></span><ChevronRight size={15}/></button><button className="rw-resource-edit" aria-label={`编辑 ${entry.name}`} onClick={() => void editResource(entry)}><Pencil size={13}/></button></div>)}{resourceError && <p className="rw-resource-error">{resourceError}</p>}{inspectorObjects.length === 0 && <p className="rw-inspector-empty">当前 Workspace 尚未登记{rightItem.label}。</p>}</>}</>}</aside>
  </main>{roomDraft && <div className="rw-room-modal-backdrop" onMouseDown={() => setRoomDraft(null)}><section className="rw-room-modal" onMouseDown={(event) => event.stopPropagation()}><header><div><h2>新建 Room</h2><p>选择这次协作直接使用的资源；以后新增的资源不会自动加入。</p></div><button aria-label="关闭" onClick={() => setRoomDraft(null)}><X size={16}/></button></header><label>Room 名称<input autoFocus value={roomDraft.title} onChange={(event) => setRoomDraft({ ...roomDraft, title: event.target.value })} placeholder="例如：跨项目架构分析"/></label><label>问题说明<textarea value={roomDraft.problemStatement} onChange={(event) => setRoomDraft({ ...roomDraft, problemStatement: event.target.value })} placeholder="这次 Room 要解决什么？"/></label><fieldset><legend>项目 <small>可多选</small></legend>{roomOptions.projects.length ? roomOptions.projects.map((item) => <label className="rw-room-check" key={item.id}><input type="checkbox" checked={roomDraft.projectIds.includes(item.id)} onChange={() => toggleRoomOption("projectIds", item.id)}/><span>{item.name}</span><small>{item.detail}</small></label>) : <p>尚未添加项目。Room 可以先创建，但未绑定本地项目时无法启动 Pi 执行。</p>}</fieldset><fieldset><legend>MCP <small>可多选</small></legend>{roomOptions.mcp.length ? roomOptions.mcp.map((item) => <label className="rw-room-check" key={item.id}><input type="checkbox" checked={roomDraft.mcpIds.includes(item.id)} onChange={() => toggleRoomOption("mcpIds", item.id)}/><span>{item.name}</span><small>{item.detail}</small></label>) : <p>尚未添加 MCP。</p>}</fieldset><fieldset><legend>Agent <small>至少选择一个</small></legend>{roomOptions.agents.map((item) => <label className="rw-room-check" key={item.id}><input type="checkbox" checked={roomDraft.agentIds.includes(item.id)} onChange={() => toggleRoomOption("agentIds", item.id)}/><span>{item.name}</span><small>{item.detail}</small>{roomDraft.agentIds.includes(item.id) && <button type="button" className={roomDraft.activeAgentId === item.id ? "active" : ""} onClick={() => setRoomDraft({ ...roomDraft, activeAgentId: item.id })}>{roomDraft.activeAgentId === item.id ? "默认执行 Agent" : "设为默认"}</button>}</label>)}</fieldset>{roomError && <p className="rw-room-error">{roomError}</p>}<footer><span>Runtime：Pi（Workspace 默认）</span><button onClick={() => void submitRoom()}>创建 Room</button></footer></section></div>}</>;
}
