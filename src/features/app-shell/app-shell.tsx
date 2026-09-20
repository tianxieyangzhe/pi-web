"use client";

import type {
  Agent,
  ActivityEvent,
  ConversationMessage,
  Mcp,
  Project,
  Room,
  RoomContent,
  RoomContentKind,
  Session,
  Workspace,
} from "@/domain/models";
import { Inspector, type InspectorTab } from "@/features/app-shell/inspector";
import { ResourceDialog, type CatalogResourceKind } from "@/features/catalog/resource-dialog";
import { FileContentPanel, type FilePreview } from "@/features/project/file-content-panel";
import type { ProjectFileTreeEntry } from "@/features/project";
import { RoomContentDialog, RoomDialog, WorkspaceDialog, type RoomContentCandidate } from "@/features/room/room-dialogs";
import { RoomSurface } from "@/features/room/room-surface";
import { SessionDialog } from "@/features/session/session-dialog";
import { ConfirmDialog } from "@/shared/ui/primitives/dialog";
import { Select } from "@/shared/ui/primitives/select";
import { FolderKanban, Layers3, MessageSquare, Pencil, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Modal =
  | { kind: "workspace"; resourceId?: string }
  | { kind: "room"; resourceId: string }
  | { kind: "session"; resourceId?: string }
  | { kind: "room-content"; resourceId?: string; initialKind?: RoomContentKind; candidateId?: string; candidate?: RoomContentCandidate; sourceSessionId?: string }
  | { kind: CatalogResourceKind; resourceId?: string }
  | { kind: "confirm-delete"; target: "workspace" | "room" | "room-content" | CatalogResourceKind; resourceId: string; name: string }
  | null;

const jsonHeaders = { "content-type": "application/json" };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.method && init.method !== "GET" && !headers.has("idempotency-key")) {
    headers.set("idempotency-key", crypto.randomUUID());
  }
  const response = await fetch(url, { ...init, headers });
  const payload = await response.json().catch(() => ({})) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(payload.error?.message ?? "请求失败");
  return payload.data as T;
}

export function AppShell({
  initialWorkspaceId = null,
  initialRoomId = null,
  initialSessionId = null,
}: {
  initialWorkspaceId?: string | null;
  initialRoomId?: string | null;
  initialSessionId?: string | null;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(initialWorkspaceId);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState<string | null>(initialRoomId);
  const [roomView, setRoomView] = useState<{
    room: Room;
    sessions: Session[];
    contents: RoomContent[];
  } | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [mcps, setMcps] = useState<Mcp[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(initialSessionId);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [candidates, setCandidates] = useState<Array<{ id: string; candidate: RoomContentCandidate; sourceSessionId: string | null }>>([]);
  const [inspectorVisible, setInspectorVisible] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("structure");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectFiles, setProjectFiles] = useState<ProjectFileTreeEntry[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [fileContents, setFileContents] = useState<FilePreview[]>([]);
  const [activeFileKey, setActiveFileKey] = useState<string | null>(null);
  const [loadedProjectDirectories, setLoadedProjectDirectories] = useState<Set<string>>(new Set());
  const [treeLoading, setTreeLoading] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [error, setError] = useState("");
  const accumulatedRef = useRef("");
  const thinkingRef = useRef("");
  const toolResultsRef = useRef<Array<{tool: string; detail: string}>>([]);

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);
  const selectedSession = roomView?.sessions.find((session) => session.id === activeSessionId)
    ?? roomView?.sessions.find((session) => session.role === "primary")
    ?? null;
  const activeFile = fileContents.find((file) => file.key === activeFileKey) ?? null;

  useEffect(() => { void loadCatalog(); }, []);
  useEffect(() => {
    if (workspaceId) void loadRooms(workspaceId);
    else { setRooms([]); setRoomId(null); }
  }, [workspaceId]);
  useEffect(() => {
    setInspectorVisible(false);
    setSelectedProjectId(null);
    setProjectFiles([]);
    setFileContents([]);
    setActiveFileKey(null);
    setLoadedProjectDirectories(new Set());
    if (roomId) void loadRoom(roomId);
    else setRoomView(null);
  }, [roomId]);
  useEffect(() => {
    if (selectedSession) void loadMessages(selectedSession);
    else setMessages([]);
    setActivities([]);
    setCandidates([]);
  }, [selectedSession?.id]);
  useEffect(() => {
    if (!workspaceId) return;
    const path = roomId
      ? `/workspaces/${workspaceId}/rooms/${roomId}${activeSessionId && selectedSession?.role === "worker" ? `?session=${activeSessionId}` : ""}`
      : `/workspaces/${workspaceId}`;
    window.history.replaceState(null, "", path);
  }, [workspaceId, roomId, activeSessionId, selectedSession?.role]);

  function showError(cause: unknown, fallback: string) {
    setError(cause instanceof Error ? cause.message : fallback);
  }

  async function loadCatalog() {
    try {
      const [loadedWorkspaces, loadedProjects, loadedMcps, loadedAgents] = await Promise.all([
        request<Workspace[]>("/api/workspaces"),
        request<Project[]>("/api/projects"),
        request<Mcp[]>("/api/mcps"),
        request<Agent[]>("/api/agents"),
      ]);
      setWorkspaces(loadedWorkspaces);
      setProjects(loadedProjects);
      setMcps(loadedMcps);
      setAgents(loadedAgents);
      setWorkspaceId((current) => loadedWorkspaces.some((workspace) => workspace.id === current)
        ? current
        : loadedWorkspaces[0]?.id ?? null);
    } catch (cause) { showError(cause, "无法加载工作空间"); }
  }

  async function refreshResources() {
    const [loadedProjects, loadedMcps, loadedAgents] = await Promise.all([
      request<Project[]>("/api/projects"),
      request<Mcp[]>("/api/mcps"),
      request<Agent[]>("/api/agents"),
    ]);
    setProjects(loadedProjects);
    setMcps(loadedMcps);
    setAgents(loadedAgents);
  }

  async function loadRooms(id: string) {
    try {
      const loaded = await request<Room[]>(`/api/workspaces/${id}/rooms`);
      setRooms(loaded);
      setRoomId((current) => loaded.some((room) => room.id === current)
        ? current
        : loaded[0]?.id ?? null);
    } catch (cause) { showError(cause, "无法加载会话"); }
  }

  async function loadRoom(id: string) {
    try {
      const view = await request<{
        room: Room;
        sessions: Session[];
        contents: RoomContent[];
      }>(`/api/rooms/${id}`);
      setRoomView(view);
      setActiveSessionId((current) => view.sessions.some((session) => session.id === current)
        ? current
        : view.sessions.find((session) => session.role === "primary")?.id
          ?? view.sessions[0]?.id
          ?? null);
      setRooms((current) => current.map((room) => room.id === view.room.id ? view.room : room));
      return view;
    } catch (cause) {
      showError(cause, "无法加载会话");
      return null;
    }
  }

  async function loadMessages(session: Session) {
    try {
      setMessages(await request<ConversationMessage[]>(
        `/api/rooms/${session.roomId}/sessions/${session.id}/messages`,
      ));
    } catch { setMessages([]); }
  }

  async function selectProject(project: Project) {
    setSelectedProjectId(project.id);
    setTreeLoading(true);
    try {
      const result = await request<{ entries: ProjectFileTreeEntry[] }>(
        `/api/projects/${project.id}/files`,
      );
      setProjectFiles(result.entries);
      setLoadedProjectDirectories(new Set([""]));
      setExpandedPaths(new Set());
    } catch (cause) { showError(cause, "无法读取项目文件"); }
    finally { setTreeLoading(false); }
  }

  async function selectFile(project: Project, entry: ProjectFileTreeEntry) {
    if (entry.type !== "file") return;
    try {
      const result = await request<{ content: string; size: number; path: string }>(
        `/api/projects/${project.id}/files/content?path=${encodeURIComponent(entry.path)}`,
      );
      const file = {
        key: `${project.id}:${result.path}`,
        projectId: project.id,
        projectName: project.name,
        path: result.path,
        content: result.content,
        size: result.size,
      } satisfies FilePreview;
      setFileContents((current) => current.some((item) => item.key === file.key)
        ? current.map((item) => item.key === file.key ? file : item)
        : [...current, file]);
      setActiveFileKey(file.key);
    } catch (cause) { showError(cause, "无法预览文件"); }
  }

  async function loadProjectDirectory(project: Project, directoryPath: string, expanded: boolean) {
    if (!expanded || loadedProjectDirectories.has(directoryPath)) return;
    try {
      const result = await request<{ entries: ProjectFileTreeEntry[] }>(
        `/api/projects/${project.id}/files?path=${encodeURIComponent(directoryPath)}`,
      );
      setProjectFiles((current) => [
        ...current.filter((entry) => entry.parentPath !== directoryPath),
        ...result.entries,
      ]);
      setLoadedProjectDirectories((current) => new Set(current).add(directoryPath));
    } catch (cause) { showError(cause, "无法读取目录内容"); }
  }

  function closeFile(key: string) {
    const index = fileContents.findIndex((file) => file.key === key);
    const remaining = fileContents.filter((file) => file.key !== key);
    setFileContents(remaining);
    setActiveFileKey((current) => current === key
      ? remaining[Math.min(index, remaining.length - 1)]?.key ?? null
      : current);
  }

  async function createRoom() {
    if (!workspaceId) return;
    try {
      const room = await request<Room>(`/api/workspaces/${workspaceId}/rooms`, { method: "POST" });
      setRooms((current) => [room, ...current]);
      setRoomId(room.id);
    } catch (cause) { showError(cause, "无法创建会话"); }
  }

  async function saveWorkspace(input: Record<string, unknown>) {
    try {
      const editing = modal?.kind === "workspace" ? modal.resourceId : undefined;
      const workspace = await request<Workspace>(
        editing ? `/api/workspaces/${editing}` : "/api/workspaces",
        { method: editing ? "PATCH" : "POST", headers: jsonHeaders, body: JSON.stringify(input) },
      );
      setWorkspaces((current) => editing
        ? current.map((item) => item.id === workspace.id ? workspace : item)
        : [...current, workspace]);
      setWorkspaceId(workspace.id);
      setModal(null);
    } catch (cause) { showError(cause, "无法保存工作空间"); }
  }

  async function saveRoom(input: Record<string, unknown>) {
    if (!roomId) return;
    try {
      await request(`/api/rooms/${roomId}`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify(input),
      });
      await loadRoom(roomId);
      setModal(null);
    } catch (cause) { showError(cause, "无法保存会话"); }
  }

  async function createSession(input: Record<string, unknown>) {
    if (!roomId) return;
    try {
      const session = await request<Session>(`/api/rooms/${roomId}/sessions`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(input),
      });
      setRoomView((current) => current
        ? { ...current, sessions: [...current.sessions, session] }
        : current);
      setActiveSessionId(session.id);
      setModal(null);
    } catch (cause) { showError(cause, "无法创建工作线"); }
  }

  async function configureSession(input: Record<string, unknown>) {
    if (!roomId || !selectedSession) return;
    try {
      await request(`/api/rooms/${roomId}/sessions/${selectedSession.id}/configuration`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify(input),
      });
      await loadRoom(roomId);
      setModal(null);
    } catch (cause) { showError(cause, "无法配置工作线"); }
  }

  async function saveResource(
    kind: CatalogResourceKind,
    resourceId: string | undefined,
    body: Record<string, unknown>,
  ) {
    try {
      const base = kind === "project" ? "/api/projects" : kind === "mcp" ? "/api/mcps" : "/api/agents";
      await request(`${base}${resourceId ? `/${resourceId}` : ""}`, {
        method: resourceId ? "PATCH" : "POST",
        headers: jsonHeaders,
        body: JSON.stringify(body),
      });
      await refreshResources();
      setModal(null);
    } catch (cause) { showError(cause, "无法保存资源"); }
  }

  async function saveRoomContent(input: Record<string, unknown>) {
    if (!roomId || modal?.kind !== "room-content") return;
    const candidateId = modal.candidateId;
    try {
      const url = `/api/rooms/${roomId}/contents${modal.resourceId ? `/${modal.resourceId}` : ""}`;
      await request(url, {
        method: modal.resourceId ? "PATCH" : "POST",
        headers: jsonHeaders,
        body: JSON.stringify(input),
      });
      await loadRoom(roomId);
      if (candidateId) setCandidates((current) => current.filter((item) => item.id !== candidateId));
      setModal(null);
    } catch (cause) { showError(cause, "无法保存结构内容"); }
  }

  async function deleteResource(target: "workspace" | "room" | "room-content" | CatalogResourceKind, resourceId: string) {
    try {
      const url = target === "workspace"
        ? `/api/workspaces/${resourceId}`
        : target === "room"
          ? `/api/rooms/${resourceId}`
          : target === "room-content"
            ? `/api/rooms/${roomId}/contents/${resourceId}`
          : target === "project"
            ? `/api/projects/${resourceId}`
            : target === "mcp"
              ? `/api/mcps/${resourceId}`
              : `/api/agents/${resourceId}`;
      await request(url, { method: "DELETE" });
      setModal(null);
      if (target === "workspace") {
        const loaded = await request<Workspace[]>("/api/workspaces");
        setWorkspaces(loaded);
        setWorkspaceId(loaded[0]?.id ?? null);
        setRoomId(null);
      } else if (target === "room") {
        if (workspaceId) await loadRooms(workspaceId);
      } else if (target === "room-content") {
        if (roomId) await loadRoom(roomId);
      } else {
        await refreshResources();
      }
    } catch (cause) { showError(cause, "无法删除"); }
  }

  function handleStreamLine(line: string): string | null {
    if (!line.trim()) return null;
    const envelope = JSON.parse(line) as {
      sessionId?: string;
      event?: { type?: string; text?: string; message?: string; state?: Session["state"] };
    };
    if (envelope.event?.type === "message_delta") {
      setActivities((current) => current.filter((item) =>
        item.id !== "runtime-starting" && item.id !== "runtime-waiting",
      ));
      accumulatedRef.current += (envelope.event?.text ?? "");
      setStreamingText(accumulatedRef.current);
    }
    if (envelope.event?.type === "session_state" && envelope.event.state && envelope.sessionId) {
      setRoomView((current) => current
        ? {
            ...current,
            sessions: current.sessions.map((session) =>
              session.id === envelope.sessionId
                ? { ...session, state: envelope.event!.state! }
                : session,
            ),
          }
        : current,
      );
      if (envelope.event.state === "starting") {
        setActivities((current) => [
          ...current.filter((item) => item.id !== "runtime-starting" && item.id !== "runtime-waiting"),
          {
            type: "activity",
            id: "runtime-starting",
            kind: "context",
            state: "running",
            summary: "正在初始化工作线",
            detail: "正在准备 Pi Runtime",
          },
        ]);
      } else if (envelope.event.state === "running") {
        setActivities((current) => [
          ...current.filter((item) => item.id !== "runtime-starting" && item.id !== "runtime-waiting"),
          {
            type: "activity",
            id: "runtime-waiting",
            kind: "context",
            state: "running",
            summary: "正在等待模型响应",
          },
        ]);
      }
    }
    if (envelope.event?.type === "tool_result") {
      const toolEvent = envelope.event as { toolName?: string; result?: unknown };
      if (toolEvent.toolName && toolEvent.result !== undefined) {
        toolResultsRef.current.push({
          tool: toolEvent.toolName,
          detail: JSON.stringify(toolEvent.result),
        });
      }
    }
    if (envelope.event?.type === "activity") {
      const activity = envelope.event as ActivityEvent;
      if (activity.kind === "thinking" || activity.kind === "tool") {
        setActivities((current) => current.filter((item) =>
          item.id !== "runtime-starting" && item.id !== "runtime-waiting",
        ));
      }
      if (activity.kind === "thinking" && activity.detail) {
        thinkingRef.current = activity.detail;
      }
      setActivities((current) => {
        const index = current.findIndex((item) => item.id === activity.id);
        if (index === -1) return [...current, activity];
        return current.map((item, itemIndex) => itemIndex === index ? activity : item);
      });
    }
    if (envelope.event?.type === "room_content_candidate") {
      const candidate = (envelope.event as { candidate: RoomContentCandidate }).candidate;
      setCandidates((current) => [...current, {
        id: crypto.randomUUID(),
        candidate,
        sourceSessionId: envelope.sessionId ?? selectedSession?.id ?? null,
      }]);
    }
    if (envelope.event?.type === "error") {
      setError(envelope.event.message ?? "工作线运行失败");
    }
    return envelope.sessionId ?? null;
  }

  async function send(content: string) {
    if (!roomId) return;
    setStreamingText("");
    setActivities([{
      type: "activity",
      id: "runtime-starting",
      kind: "context",
      state: "running",
      summary: "正在初始化工作线",
      detail: "正在准备 Pi Runtime",
    }]);
    setCandidates([]);
    const optimisticMessageId = crypto.randomUUID();
    setMessages((current) => [...current, {
      id: optimisticMessageId,
      sessionId: selectedSession?.id ?? "pending",
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    }]);
    const url = selectedSession?.role === "worker"
      ? `/api/rooms/${roomId}/sessions/${selectedSession.id}/messages`
      : `/api/rooms/${roomId}/messages`;
    let completedSessionId = selectedSession?.id ?? null;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { ...jsonHeaders, "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ content }),
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({})) as {
          error?: { message?: string };
        };
        throw new Error(payload.error?.message ?? "消息发送失败");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          completedSessionId = handleStreamLine(line) ?? completedSessionId;
        }
      }
      if (buffer.trim()) completedSessionId = handleStreamLine(buffer) ?? completedSessionId;
      const finalText = accumulatedRef.current;
      const finalThinking = thinkingRef.current;
      const finalToolResults = toolResultsRef.current.length > 0
        ? JSON.stringify(toolResultsRef.current)
        : undefined;
      accumulatedRef.current = "";
      thinkingRef.current = "";
      toolResultsRef.current = [];
      setStreamingText("");
      setActivities([]);
      if (finalText && completedSessionId) {
        setMessages((current) => [...current, {
          id: crypto.randomUUID(),
          sessionId: completedSessionId,
          role: "assistant",
          content: finalText,
          ...(finalThinking ? { thinking: finalThinking } : {}),
          ...(finalToolResults ? { toolResults: finalToolResults } : {}),
          createdAt: new Date().toISOString(),
        } as ConversationMessage]);
      }
      const view = await loadRoom(roomId);
      const completedSession = view?.sessions.find((session) => session.id === completedSessionId)
        ?? (selectedSession?.role === "worker"
          ? null
          : view?.sessions.find((session) => session.role === "primary"));
      if (completedSession) {
        setActiveSessionId(completedSession.id);
        await loadMessages(completedSession);
      }
    } catch (cause) {
      setMessages((current) => current.filter((message) => message.id !== optimisticMessageId));
      showError(cause, "消息发送失败");
      if (selectedSession) void loadMessages(selectedSession);
    } finally {
      setStreamingText("");
      setActivities([]);
    }
  }

  async function interrupt() {
    if (!selectedSession) return;
    try {
      await request(`/api/rooms/${selectedSession.roomId}/sessions/${selectedSession.id}/interrupt`, {
        method: "POST",
      });
      await loadRoom(selectedSession.roomId);
    } catch (cause) { showError(cause, "无法停止工作线"); }
  }

  async function sessionAction(action: "restore" | "end") {
    if (!selectedSession) return;
    try {
      await request(`/api/rooms/${selectedSession.roomId}/sessions/${selectedSession.id}/${action}`, {
        method: "POST",
      });
      await loadRoom(selectedSession.roomId);
    } catch (cause) { showError(cause, action === "restore" ? "无法恢复工作线" : "无法结束工作线"); }
  }

  async function adoptCandidate(
    id: string,
    candidate: RoomContentCandidate,
    sourceSessionId: string | null,
  ) {
    if (!roomId) return;
    const status = candidate.kind === "goal" ? "active" : candidate.kind === "direction" ? "adopted" : "published";
    try {
      await request(`/api/rooms/${roomId}/contents`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ ...candidate, status, sourceSessionId }),
      });
      setCandidates((current) => current.filter((item) => item.id !== id));
      await loadRoom(roomId);
    } catch (cause) { showError(cause, "无法采用候选内容"); }
  }

  const editedContent = modal?.kind === "room-content" && modal.resourceId
    ? roomView?.contents.find((item) => item.id === modal.resourceId)
    : undefined;

  return (
    <div className={`grid h-screen min-h-[600px] overflow-hidden bg-slate-100 font-sans text-slate-800 md:grid-cols-[220px_minmax(0,1fr)] ${fileContents.length ? inspectorVisible ? "xl:grid-cols-[248px_minmax(480px,1fr)_minmax(420px,38vw)_350px]" : "xl:grid-cols-[248px_minmax(520px,1fr)_minmax(420px,42vw)]" : inspectorVisible ? "xl:grid-cols-[248px_minmax(560px,1fr)_400px]" : "xl:grid-cols-[248px_minmax(640px,1fr)]"}`}>
      {sidebarVisible && <button className="fixed inset-0 z-[69] bg-slate-950/30 md:hidden" aria-label="隐藏工作空间导航" onClick={() => setSidebarVisible(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-[70] flex w-[230px] -translate-x-full flex-col overflow-hidden border-r border-slate-200 bg-slate-50 transition-transform md:static md:z-auto md:w-auto md:translate-x-0 ${sidebarVisible ? "translate-x-0 shadow-2xl" : ""}`}>
        <div className="flex h-[68px] items-center gap-3 border-b border-slate-200 px-[18px] text-[15px] font-bold tracking-tight text-slate-900"><span className="grid size-[30px] place-items-center rounded-[9px] bg-teal-700 text-white shadow-lg shadow-teal-800/20"><Sparkles size={16} /></span><span>AI Workspace</span></div>
        <div className="grid gap-2 px-3.5 pt-[18px]">
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">工作空间</div>
          <div className="grid grid-cols-[minmax(0,1fr)_34px] items-start gap-1">
            <Select
              ariaLabel="选择工作空间"
              value={workspaceId ?? ""}
              options={workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name }))}
              onChange={(id) => { setWorkspaceId(id); setRoomId(null); setSidebarVisible(false); }}
            />
            {selectedWorkspace && <button className="grid size-[34px] place-items-center rounded-lg text-slate-500 transition hover:bg-slate-200 hover:text-slate-800" aria-label="修改工作空间" onClick={() => setModal({ kind: "workspace", resourceId: selectedWorkspace.id })}><Pencil size={14} /></button>}
          </div>
          <button className="inline-flex min-h-9 items-center justify-start gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 transition hover:bg-slate-100" onClick={() => setModal({ kind: "workspace" })}><Plus size={14} />新建工作空间</button>
        </div>
        <button className="mx-3.5 mt-4 inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-teal-700 px-3 text-xs font-bold text-white shadow-lg shadow-teal-800/20 transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-45" onClick={() => void createRoom()} disabled={!workspaceId}><Plus size={16} />新会话</button>
        <div className="min-h-0 overflow-auto px-3.5 pt-[18px]">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">会话</div>
          {rooms.length ? rooms.map((room) => (
            <div key={room.id} className={`flex min-h-10 items-center gap-0.5 rounded-lg px-1 ${room.id === roomId ? "bg-teal-100 text-teal-800 shadow-[inset_3px_0_0_#0f766e]" : "text-slate-600 hover:bg-slate-200/70"}`}>
              <button className="flex min-w-0 flex-1 items-center gap-2 px-1.5 text-left text-xs" onClick={() => { setRoomId(room.id); setSidebarVisible(false); }}><MessageSquare size={14} /><span className="min-w-0 flex-1 truncate">{room.title}</span><small className="text-[9px] text-amber-700">{room.status === "active" ? "" : room.status}</small></button>
              <button className="grid size-8 place-items-center rounded-lg text-slate-500 transition hover:bg-white/70" aria-label={`修改 ${room.title}`} onClick={() => { setRoomId(room.id); setModal({ kind: "room", resourceId: room.id }); }}><Pencil size={13} /></button>
            </div>
          )) : <p className="m-2 text-[11px] text-slate-400">还没有会话</p>}
        </div>
        <div className="mt-auto border-t border-slate-200 px-3.5 pt-[18px] pb-3.5">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">资源</div>
          {(["projects", "mcps", "agents"] as const).map((tab) => (
            <button className="flex min-h-10 w-full items-center gap-2 rounded-lg px-1.5 text-left text-xs text-slate-600 transition hover:bg-slate-200/70" key={tab} onClick={() => { setInspectorTab(tab); setInspectorVisible(true); }}>
              {tab === "projects" ? <FolderKanban size={14} /> : tab === "mcps" ? <Layers3 size={14} /> : <Sparkles size={14} />}
              {tab === "projects" ? "项目" : tab === "mcps" ? "MCP" : "Agent"}
            </button>
          ))}
        </div>
        <div className="flex justify-between border-t border-slate-200 px-[18px] py-3 text-[10px] text-slate-400"><span>本地优先</span><span>Pi Runtime</span></div>
      </aside>

      <RoomSurface
        room={roomView?.room ?? null}
        sessions={roomView?.sessions ?? []}
        contents={roomView?.contents ?? []}
        messages={messages}
        streamingText={streamingText}
        activities={activities}
        candidates={candidates}
        activeSessionId={activeSessionId}
        inspectorVisible={inspectorVisible}
        onSessionSelect={(session) => setActiveSessionId(session.id)}
        onCreateSession={() => setModal({ kind: "session" })}
        onSend={(content) => void send(content)}
        onInterrupt={() => void interrupt()}
        onConfigureSession={() => selectedSession && setModal({ kind: "session", resourceId: selectedSession.id })}
        onRestoreSession={() => void sessionAction("restore")}
        onEndSession={() => void sessionAction("end")}
        onAdoptCandidate={(id, candidate) => {
          const item = candidates.find((value) => value.id === id);
          void adoptCandidate(id, candidate, item?.sourceSessionId ?? null);
        }}
        onEditCandidate={(id, candidate) => {
          const item = candidates.find((value) => value.id === id);
          setModal({ kind: "room-content", candidateId: id, candidate, sourceSessionId: item?.sourceSessionId ?? undefined });
        }}
        onDismissCandidate={(id) => setCandidates((current) => current.filter((item) => item.id !== id))}
        onEditRoom={() => roomId && setModal({ kind: "room", resourceId: roomId })}
        onToggleSidebar={() => setSidebarVisible((visible) => !visible)}
        onToggleInspector={() => setInspectorVisible((visible) => !visible)}
      />

      {inspectorVisible && <Inspector
        tab={inspectorTab}
        sessions={roomView?.sessions ?? []}
        contents={roomView?.contents ?? []}
        projects={projects}
        mcps={mcps}
        agents={agents}
        selectedSession={selectedSession}
        projectFiles={projectFiles}
        filesLoading={treeLoading}
        selectedProjectId={selectedProjectId}
        activeFilePath={activeFile?.projectId === selectedProjectId ? activeFile.path : null}
        fileContentVisible={fileContents.length > 0}
        expandedPaths={expandedPaths}
        onTabChange={setInspectorTab}
        onSelectProject={(project) => void selectProject(project)}
        onSelectFile={(entry) => {
          const project = projects.find((item) => item.id === selectedProjectId);
          if (project) void selectFile(project, entry);
        }}
        onExpandedChange={setExpandedPaths}
        onFolderToggle={(path, expanded) => {
          const project = projects.find((item) => item.id === selectedProjectId);
          if (project) void loadProjectDirectory(project, path, expanded);
        }}
        onCreateResource={() => setModal({
          kind: inspectorTab === "projects" ? "project" : inspectorTab === "mcps" ? "mcp" : "agent",
        })}
        onEditResource={(kind, id) => setModal({ kind, resourceId: id })}
        onCreateContent={(initialKind) => setModal({ kind: "room-content", initialKind })}
        onEditContent={(resourceId) => setModal({ kind: "room-content", resourceId })}
        onClose={() => setInspectorVisible(false)}
      />}

      {fileContents.length > 0 && activeFileKey && <FileContentPanel files={fileContents} activeKey={activeFileKey} onSelect={setActiveFileKey} onCloseFile={closeFile} onCloseAll={() => { setFileContents([]); setActiveFileKey(null); }} />}
      {modal?.kind === "workspace" && <WorkspaceDialog
        workspace={workspaces.find((item) => item.id === modal.resourceId)}
        onClose={() => setModal(null)}
        onSave={(input) => void saveWorkspace(input)}
        onDelete={modal.resourceId ? () => setModal({ kind: "confirm-delete", target: "workspace", resourceId: modal.resourceId!, name: workspaces.find((item) => item.id === modal.resourceId)?.name ?? "工作空间" }) : undefined}
      />}
      {modal?.kind === "room" && roomView && <RoomDialog
        room={roomView.room}
        onClose={() => setModal(null)}
        onSave={(input) => void saveRoom(input)}
        onDelete={() => setModal({ kind: "confirm-delete", target: "room", resourceId: roomView.room.id, name: roomView.room.title })}
      />}
      {modal?.kind === "session" && <SessionDialog
        session={modal.resourceId ? selectedSession : null}
        projects={projects}
        mcps={mcps}
        agents={agents}
        onClose={() => setModal(null)}
        onSave={(input) => void (modal.resourceId ? configureSession(input) : createSession(input))}
      />}
      {(modal?.kind === "project" || modal?.kind === "mcp" || modal?.kind === "agent") && <ResourceDialog
        kind={modal.kind}
        resourceId={modal.resourceId}
        projects={projects}
        mcps={mcps}
        agents={agents}
        onClose={() => setModal(null)}
        onSave={(kind, id, input) => void saveResource(kind, id, input)}
        onDelete={modal.resourceId ? () => {
          const item = modal.kind === "project" ? projects.find((value) => value.id === modal.resourceId) : modal.kind === "mcp" ? mcps.find((value) => value.id === modal.resourceId) : agents.find((value) => value.id === modal.resourceId);
          setModal({ kind: "confirm-delete", target: modal.kind, resourceId: modal.resourceId!, name: item?.name ?? "资源" });
        } : undefined}
      />}
      {modal?.kind === "room-content" && <RoomContentDialog
        content={editedContent}
        candidate={modal.candidate}
        initialKind={modal.initialKind}
        onClose={() => setModal(null)}
        onSave={(input) => void saveRoomContent({ ...input, sourceSessionId: modal.sourceSessionId ?? null })}
        onDelete={editedContent ? () => setModal({ kind: "confirm-delete", target: "room-content", resourceId: editedContent.id, name: editedContent.title }) : undefined}
      />}
      {modal?.kind === "confirm-delete" && <ConfirmDialog
        title={`删除${modal.target === "workspace" ? "工作空间" : modal.target === "room" ? "会话" : modal.target === "room-content" ? "内容" : "资源"}`}
        body={`将删除“${modal.name}”。此操作不能在应用内撤销；正在被工作线使用的独立资源会被服务端拒绝删除。`}
        onClose={() => setModal(null)}
        onConfirm={() => void deleteResource(modal.target, modal.resourceId)}
      />}
      {error && <button className="fixed right-4 bottom-4 z-[120] flex max-w-[420px] items-center gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-left text-[11px] text-red-800 shadow-xl shadow-slate-900/10" onClick={() => setError("")}>{error}<X size={14} /></button>}
    </div>
  );
}
