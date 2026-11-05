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

async function* stream<T>(url: string, init: RequestInit, fallback: string, onAccepted?: () => void): AsyncGenerator<T> {
  const started = performance.now();
  let firstTextLogged = false;
  let completeLogged = false;
  const parseEvent = (line: string): T => {
    const envelope = JSON.parse(line) as { event?: T; turnId?: unknown; runId?: unknown; sessionId?: unknown; payload?: unknown };
    const event = (envelope.event ?? envelope.payload) as { type?: string; text?: string } | null;
    const stage = !firstTextLogged && event?.type === "message_delta" && event.text ? "first_text_received"
      : !completeLogged && event?.type === "complete" ? "complete_received" : null;
    const turnId = envelope.turnId ?? envelope.runId;
    if (stage && typeof turnId === "string" && typeof envelope.sessionId === "string") {
      if (stage === "first_text_received") firstTextLogged = true;
      else completeLogged = true;
      try {
        console.info(`[project-message-stream] ${JSON.stringify({ turnId, sessionId: envelope.sessionId, stage, elapsedMs: Math.round((performance.now() - started) * 10) / 10, at: new Date().toISOString() })}`);
      } catch { /* best effort */ }
    }
    return (envelope.event ?? envelope) as T;
  };
  const response = await fetch(url, init);
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({})) as ApiEnvelope<never>;
    throw new Error(`${payload.error?.message ?? fallback}（${response.status} ${url}）`);
  }
  onAccepted?.();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    buffer += decoder.decode(part.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) yield parseEvent(line);
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield parseEvent(buffer);
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
  prepareAgent:(body:Record<string,unknown>,signal:AbortSignal)=>request<{suggestedStatus?:"active"|"disabled";name:string;description:string|null;definition:import("../domain/models").AgentDefinition;warnings:string[];sources:Array<{path:string;hash:string}>}>("/api/agents/prepare",{...mutation("POST",body),signal}),
  listAgents: () => request<Agent[]>("/api/agents"),
  getAgent: (id: string) => request<Agent>(`/api/agents/${id}`),
  createAgent: (body: Record<string, unknown>,signal?:AbortSignal) => request<Agent>("/api/agents", {...mutation("POST", body),signal}),
  updateAgent: (id: string, body: Record<string, unknown>,signal?:AbortSignal) => request<Agent>(`/api/agents/${id}`,  {...mutation("PATCH", body),signal,headers:{...jsonHeaders,"if-match":String(body.writeETag??'')}}),
  deleteAgent: (id: string) => request<{ deleted: boolean; archived:boolean }>(`/api/agents/${id}`, mutation("DELETE")),
  listMcps: () => request<Mcp[]>("/api/mcps"),
  getMcp: (id: string) => request<Mcp>(`/api/mcps/${id}`),
  createMcp: (body: Record<string, unknown>) => request<Mcp>("/api/mcps", mutation("POST", body)),
  updateMcp: (id: string, body: Record<string, unknown>) => request<Mcp>(`/api/mcps/${id}`, mutation("PATCH", body)),
  deleteMcp: (id: string) => request<{ deleted: boolean }>(`/api/mcps/${id}`, mutation("DELETE")),
  testMcp: (id: string) => request<never>(`/api/mcps/${id}/test`, mutation("POST")),
  configureSessionRole:(projectId:string,s:Session,agentId:string,revision?:number,contentSha256?:string)=>request<Session>(`/api/projects/${projectId}/sessions/${s.id}/role`,{...mutation("POST",{agentId,revision,contentSha256}),headers:{...jsonHeaders,"if-match":s.writeETag}}),
  deleteSession: (projectId: string, sessionId: string) => request<{deleted: boolean; sessionId: string}>(`/api/projects/${projectId}/sessions/${sessionId}`, mutation("DELETE")),
  listSessions: (projectId: string) => request<Session[]>(`/api/projects/${projectId}/sessions`),
  createSession: (projectId: string, body: Record<string, unknown> = {}) => request<Session>(`/api/projects/${projectId}/sessions`, mutation("POST", body)),
  openSession: (projectId:string,sessionId:string) => request<{leaseId:string;status:string;outcome:string|null}>(`/api/projects/${projectId}/sessions/${sessionId}/runtime/open`, mutation("POST")),
  closeSession: (projectId:string,sessionId:string,leaseId:string) => fetch(`/api/projects/${projectId}/sessions/${sessionId}/runtime/close`, {...mutation("POST", {leaseId}), keepalive:true}).then(() => {}),
  listMessages: (projectId: string, sessionId: string) => request<import("../domain/models").SessionTree>(`/api/projects/${projectId}/sessions/${sessionId}/messages`, {cache:"no-store"}),
  sendMessage: (projectId: string, sessionId: string, leaseId:string, content: string, steer=false, onAccepted?: () => void, references?: import("../../src/domain/message-references").MessageReference[]) => stream<import("../domain/models").PiStreamEvent>(`/api/projects/${projectId}/sessions/${sessionId}/messages`, { ...mutation("POST", { content,steer,references }), headers: { ...jsonHeaders, "idempotency-key": crypto.randomUUID(), "x-session-lease-id":leaseId } }, "无法发送项目消息", onAccepted),
  interruptProjectSession: (projectId: string, sessionId: string) => request<Session>(`/api/projects/${projectId}/sessions/${sessionId}/interrupt`, mutation("POST")),
  restoreProjectSession: (projectId: string, sessionId: string) => request<Session>(`/api/projects/${projectId}/sessions/${sessionId}/restore`, mutation("POST")),
  endProjectSession: (projectId: string, sessionId: string) => request<Session>(`/api/projects/${projectId}/sessions/${sessionId}/end`, mutation("POST")),
  listFiles: (projectId: string, path = "") => request<ProjectFileListing>(`/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`),
  readFile: (projectId: string, path: string) => request<FilePreview>(`/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`),
  listChanges: (projectId: string) => request<ProjectChanges>(`/api/projects/${projectId}/changes`),
};
