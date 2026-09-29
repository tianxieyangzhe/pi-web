import type { Agent, AgentEvent, ConversationMessage, FilePreview, Mcp, Project, ProjectChanges, ProjectFileListing, Room, RoomContent, RoomEntry, RoomEvent, RoomRun, RoomView, Session, Task } from "../domain/models";

type ApiEnvelope<T> = { data?: T; error?: { message?: string; code?: string } };
const jsonHeaders = { "content-type": "application/json" };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.method && init.method !== "GET" && !headers.has("idempotency-key")) headers.set("idempotency-key", crypto.randomUUID());
  const response = await fetch(url, { ...init, headers });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok) throw new Error(`${payload.error?.message ?? "请求失败"}（${response.status} ${url}）`);
  return payload.data as T;
}

async function* stream<T>(url: string, init: RequestInit, fallback: string): AsyncGenerator<T> {
  const response = await fetch(url, init);
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({})) as ApiEnvelope<never>;
    throw new Error(`${payload.error?.message ?? fallback}（${response.status} ${url}）`);
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
    for (const line of lines) if (line.trim()) yield (JSON.parse(line) as { event: T }).event;
  }
  if (buffer.trim()) yield (JSON.parse(buffer) as { event: T }).event;
}

function mutation(method: string, body?: unknown): RequestInit {
  return { method, headers: jsonHeaders, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}

export const api = {
  listProjects: () => request<Project[]>("/api/projects"),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),
  createProject: (body: Record<string, unknown>) => request<Project>("/api/projects", mutation("POST", body)),
  updateProject: (id: string, body: Record<string, unknown>) => request<Project>(`/api/projects/${id}`, mutation("PATCH", body)),
  deleteProject: (id: string) => request<{ deleted: boolean }>(`/api/projects/${id}`, mutation("DELETE")),
  listAgents: () => request<Agent[]>("/api/agents"),
  getAgent: (id: string) => request<Agent>(`/api/agents/${id}`),
  createAgent: (body: Record<string, unknown>) => request<Agent>("/api/agents", mutation("POST", body)),
  updateAgent: (id: string, body: Record<string, unknown>) => request<Agent>(`/api/agents/${id}`, mutation("PATCH", body)),
  deleteAgent: (id: string) => request<{ deleted: boolean }>(`/api/agents/${id}`, mutation("DELETE")),
  listMcps: () => request<Mcp[]>("/api/mcps"),
  getMcp: (id: string) => request<Mcp>(`/api/mcps/${id}`),
  createMcp: (body: Record<string, unknown>) => request<Mcp>("/api/mcps", mutation("POST", body)),
  updateMcp: (id: string, body: Record<string, unknown>) => request<Mcp>(`/api/mcps/${id}`, mutation("PATCH", body)),
  deleteMcp: (id: string) => request<{ deleted: boolean }>(`/api/mcps/${id}`, mutation("DELETE")),
  testMcp: (id: string) => request<never>(`/api/mcps/${id}/test`, mutation("POST")),
  listRooms: async (projectId?: string) => {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    return request<Room[]>(`/api/rooms${query}`);
  },
  getRoom: (id: string) => request<RoomView>(`/api/rooms/${id}`),
  createRoom: (body: Record<string, unknown>) => request<Room>("/api/rooms", mutation("POST", body)),
  updateRoom: (id: string, body: Record<string, unknown>) => request<Room>(`/api/rooms/${id}`, mutation("PATCH", body)),
  deleteRoom: (id: string) => request<{ deleted: boolean }>(`/api/rooms/${id}`, mutation("DELETE")),
  listRoomEntries: async () => {
    const rooms = await api.listRooms();
    return Promise.all(rooms.map(async (room): Promise<RoomEntry> => ({ room: { id: room.id, title: room.title, status: room.status, kind: "cross_project" }, projectIds: (await api.getRoom(room.id)).scope.map((item) => item.projectId) })));
  },
  listRoomRuns: (roomId: string) => request<RoomRun[]>(`/api/rooms/${roomId}/runs`),
  listRoomContents: (roomId: string) => request<RoomContent[]>(`/api/rooms/${roomId}/contents`),
  createRoomContent: (roomId: string, body: Record<string, unknown>) => request<RoomContent>(`/api/rooms/${roomId}/contents`, mutation("POST", body)),
  updateRoomContent: (roomId: string, contentId: string, body: Record<string, unknown>) => request<RoomContent>(`/api/rooms/${roomId}/contents/${contentId}`, mutation("PATCH", body)),
  deleteRoomContent: (roomId: string, contentId: string) => request<{ deleted: boolean }>(`/api/rooms/${roomId}/contents/${contentId}`, mutation("DELETE")),
  listProjectRooms: (projectId: string) => request<Room[]>(`/api/projects/${projectId}/rooms`),
  listSessions: (projectId: string) => request<Session[]>(`/api/projects/${projectId}/sessions`),
  createSession: (projectId: string, body: Record<string, unknown> = {}) => request<Session>(`/api/projects/${projectId}/sessions`, mutation("POST", body)),
  listMessages: (projectId: string, sessionId: string) => request<ConversationMessage[]>(`/api/projects/${projectId}/sessions/${sessionId}/messages`),
  sendMessage: (projectId: string, sessionId: string, content: string) => stream<AgentEvent>(`/api/projects/${projectId}/sessions/${sessionId}/messages`, { ...mutation("POST", { content }), headers: { ...jsonHeaders, "idempotency-key": crypto.randomUUID() } }, "无法发送项目消息"),
  interruptProjectSession: (projectId: string, sessionId: string) => request<Session>(`/api/projects/${projectId}/sessions/${sessionId}/interrupt`, mutation("POST")),
  restoreProjectSession: (projectId: string, sessionId: string) => request<Session>(`/api/projects/${projectId}/sessions/${sessionId}/restore`, mutation("POST")),
  endProjectSession: (projectId: string, sessionId: string) => request<Session>(`/api/projects/${projectId}/sessions/${sessionId}/end`, mutation("POST")),
  interruptRoomSession: (roomId: string, sessionId: string) => request<Session>(`/api/rooms/${roomId}/sessions/${sessionId}/interrupt`, mutation("POST")),
  restoreRoomSession: (roomId: string, sessionId: string) => request<Session>(`/api/rooms/${roomId}/sessions/${sessionId}/restore`, mutation("POST")),
  endRoomSession: (roomId: string, sessionId: string) => request<Session>(`/api/rooms/${roomId}/sessions/${sessionId}/end`, mutation("POST")),
  listFiles: (projectId: string, path = "") => request<ProjectFileListing>(`/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`),
  readFile: (projectId: string, path: string) => request<FilePreview>(`/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`),
  listChanges: (projectId: string) => request<ProjectChanges>(`/api/projects/${projectId}/changes`),
  submitRoomRun: (roomId: string, requestText: string, projectHintId: string | null = null) => stream<RoomEvent>(`/api/rooms/${roomId}/cross-project-runs`, { ...mutation("POST", { request: requestText, projectHintId }), headers: { ...jsonHeaders, "idempotency-key": crypto.randomUUID() } }, "无法提交跨项目请求"),
  approveRoomRun: (roomId: string, runId: string) => stream<RoomEvent>(`/api/rooms/${roomId}/cross-project-runs/${runId}/approve`, { ...mutation("POST"), headers: { "idempotency-key": crypto.randomUUID() } }, "无法批准计划"),
  cancelRoomRun: (roomId: string, runId: string) => request<RoomRun>(`/api/rooms/${roomId}/cross-project-runs/${runId}/cancel`, mutation("POST")),
};
