import type {NativeContextInspection} from "../domain/native-context";
import type { SessionMemoryView, SessionMemory } from "../domain/session-memory";
import type { Agent, AgentEvent, ConversationMessage, FilePreview, Mcp, Project, ProjectChanges, ProjectFileListing, Session } from "../domain/models";

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

const contextRequests=new Map<string,Promise<NativeContextInspection>>();
function readNativeContext(projectId:string,sessionId:string){
  const url=`/api/projects/${projectId}/sessions/${sessionId}/context`;
  const current=contextRequests.get(url);if(current)return current;
  const pending=request<NativeContextInspection>(url).finally(()=>{if(contextRequests.get(url)===pending)contextRequests.delete(url);});
  contextRequests.set(url,pending);return pending;
}

export const api = {
  getSessionMemory: (projectId:string,sessionId:string) => request<SessionMemoryView>(`/api/projects/${projectId}/sessions/${sessionId}/memory`),
  changeSessionMemory: (projectId:string,sessionId:string,action:string,etag:string,body:unknown,signal?:AbortSignal) => request<SessionMemoryView>(`/api/projects/${projectId}/sessions/${sessionId}/memory/${action}`, {...mutation(action === "context" || action === "draft" ? "PATCH" : "POST",body), signal, headers:{...jsonHeaders,"if-match":etag}}),
  getNativeContext: readNativeContext,
  compactNativeContext: (projectId:string,sessionId:string) => request<NativeContextInspection>(`/api/projects/${projectId}/sessions/${sessionId}/compact`,mutation("POST")),
  cancelNativeCompaction: (projectId:string,sessionId:string) => request<NativeContextInspection>(`/api/projects/${projectId}/sessions/${sessionId}/compact/cancel`,mutation("POST")),
  listSessionMemoryTemplates: () => request<Array<{sessionMemory:SessionMemory;writeETag:string}>>("/api/session-memory-templates"),
  saveSessionMemoryTemplate: (id:string|null,etag:string|null,body:unknown) => request<SessionMemory>(id ? `/api/session-memory-templates/${id}` : "/api/session-memory-templates", {...mutation(id ? "PATCH" : "POST",body),headers:{...jsonHeaders,...(etag ? {"if-match":etag}:{})}}),
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
  listSessions: (projectId: string) => request<Session[]>(`/api/projects/${projectId}/sessions`),
  createSession: (projectId: string, body: Record<string, unknown> = {}) => request<Session>(`/api/projects/${projectId}/sessions`, mutation("POST", body)),
  listMessages: (projectId: string, sessionId: string) => request<ConversationMessage[]>(`/api/projects/${projectId}/sessions/${sessionId}/messages`),
  sendMessage: (projectId: string, sessionId: string, content: string) => stream<AgentEvent>(`/api/projects/${projectId}/sessions/${sessionId}/messages`, { ...mutation("POST", { content }), headers: { ...jsonHeaders, "idempotency-key": crypto.randomUUID() } }, "无法发送项目消息"),
  interruptProjectSession: (projectId: string, sessionId: string) => request<Session>(`/api/projects/${projectId}/sessions/${sessionId}/interrupt`, mutation("POST")),
  restoreProjectSession: (projectId: string, sessionId: string) => request<Session>(`/api/projects/${projectId}/sessions/${sessionId}/restore`, mutation("POST")),
  endProjectSession: (projectId: string, sessionId: string) => request<Session>(`/api/projects/${projectId}/sessions/${sessionId}/end`, mutation("POST")),
  listFiles: (projectId: string, path = "") => request<ProjectFileListing>(`/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`),
  readFile: (projectId: string, path: string) => request<FilePreview>(`/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`),
  listChanges: (projectId: string) => request<ProjectChanges>(`/api/projects/${projectId}/changes`),
};
