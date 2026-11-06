import { downloadFile, readFileBlob } from "./file-download";
import { randomUUID } from "./random-uuid";
import type {NativeContextInspection} from "../domain/native-context";
import type { SessionModelView, RecoveryView } from "../../src/domain/session-tools";
import type { Agent, FilePreview, Mcp, Project, ProjectChanges, ProjectFileListing, Session } from "../domain/models";

type ApiEnvelope<T> = { data?: T; error?: { message?: string; code?: string } };
const jsonHeaders = { "content-type": "application/json" };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.method && init.method !== "GET" && !headers.has("idempotency-key")) headers.set("idempotency-key", randomUUID());
  const response = await fetch(url, { ...init, headers });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok) throw new Error(`${payload.error?.message ?? "请求失败"}（${response.status} ${url}）`);
  return payload.data as T;
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
  getNativeContext: readNativeContext,
  sessionModels: (projectId:string,id:string,leaseId?:string) => request<SessionModelView>(`/api/projects/${projectId}/sessions/${id}/models`,{headers:leaseId?{"x-session-lease-id":leaseId}:{}}),
  switchSessionModel: (projectId:string,id:string,provider:string,modelId:string,leaseId:string,thinkingLevel?:import('../../src/domain/session-tools').SessionThinkingLevel) => request<SessionModelView>(`/api/projects/${projectId}/sessions/${id}/model`,{...mutation("PUT",{provider,modelId,thinkingLevel}),headers:{...jsonHeaders,"x-session-lease-id":leaseId}}),
  forkSession: (projectId:string,id:string,entryId:string) => request<Session>(`/api/projects/${projectId}/sessions/${id}/fork`,mutation("POST",{entryId})),
  recoverSession: (projectId:string,id:string,operationId:string,action:string) => request<RecoveryView>(`/api/projects/${projectId}/sessions/${id}/recover`,mutation("POST",{operationId,action})),
  exportSession: async (projectId:string,id:string,format:"html"|"jsonl",scope:"tree"|"branch") => {
    const response=await fetch(`/api/projects/${projectId}/sessions/${id}/export?format=${format}&scope=${scope}`,{cache:"no-store"});
    if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error?.message??"导出失败");}
    const blob=await response.blob(),length=response.headers.get("content-length");
    if(length!==null&&blob.size!==Number(length))throw new Error("下载不完整，请重试");
    const url=URL.createObjectURL(blob),anchor=document.createElement("a");anchor.href=url;anchor.download=`${id}-${scope}.${format}`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  },
  compactNativeContext: async (projectId:string,sessionId:string,leaseId?:string) => (await request<{inspection:NativeContextInspection}>(`/api/projects/${projectId}/sessions/${sessionId}/compact`,{...mutation("POST"),headers:{...jsonHeaders,"x-session-lease-id":leaseId??""}})).inspection,
  cancelNativeCompaction: async (projectId:string,sessionId:string) => (await request<{inspection:NativeContextInspection}>(`/api/projects/${projectId}/sessions/${sessionId}/compact/cancel`,mutation("POST"))).inspection,
  listProjects: () => request<Project[]>("/api/projects"),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),
  createProject: (body: Record<string, unknown>) => request<Project>("/api/projects", mutation("POST", body)),
  updateProject: (id: string, body: Record<string, unknown>,etag?:string) => request<Project>(`/api/projects/${id}`, {...mutation("PATCH", body),headers:{...jsonHeaders,"if-match":etag??""}}),
  deleteProject: (id: string,etag?:string) => request<{ deleted: boolean }>(`/api/projects/${id}`, {...mutation("DELETE"),headers:{"if-match":etag??""}}),
  prepareAgent:(body:Record<string,unknown>,signal:AbortSignal)=>request<{suggestedStatus?:"active"|"disabled";name:string;description:string|null;definition:import("../domain/models").AgentDefinition;warnings:string[];sources:Array<{path:string;hash:string}>}>("/api/agents/prepare",{...mutation("POST",body),signal}),
  listAgents: () => request<Agent[]>("/api/agents"),
  getAgent: (id: string) => request<Agent>(`/api/agents/${id}`),
  createAgent: (body: Record<string, unknown>,signal?:AbortSignal) => request<Agent>("/api/agents", {...mutation("POST", body),signal}),
  updateAgent: (id: string, body: Record<string, unknown>,signal?:AbortSignal) => request<Agent>(`/api/agents/${id}`,  {...mutation("PATCH", Object.fromEntries(Object.entries(body).filter(([key])=>key!=="writeETag"))),signal,headers:{...jsonHeaders,"if-match":String(body.writeETag??'')}}),
  deleteAgent: (id: string,etag?:string) => request<{ deleted: boolean; archived:boolean }>(`/api/agents/${id}`,{...mutation("DELETE"),headers:{"if-match":etag??""}}),
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
  interruptProjectSession: (projectId: string, sessionId: string) => request<Session>(`/api/projects/${projectId}/sessions/${sessionId}/interrupt`, mutation("POST")),
  restoreProjectSession: (projectId: string, sessionId: string) => request<Session>(`/api/projects/${projectId}/sessions/${sessionId}/restore`, mutation("POST")),
  endProjectSession: (projectId: string, sessionId: string) => request<Session>(`/api/projects/${projectId}/sessions/${sessionId}/end`, mutation("POST")),
  listFiles: (projectId: string, path = "") => request<ProjectFileListing>(`/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`),
  readFileBlob: (projectId:string,path:string,signal?:AbortSignal) => readFileBlob(`/api/projects/${encodeURIComponent(projectId)}/files/download?path=${encodeURIComponent(path)}`,signal),
  downloadFile: (projectId: string, path: string) => downloadFile(`/api/projects/${encodeURIComponent(projectId)}/files/download?path=${encodeURIComponent(path)}`, path),
  readFile: (projectId: string, path: string) => request<FilePreview>(`/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`),
  listChanges: (projectId: string) => request<ProjectChanges>(`/api/projects/${projectId}/changes`),
};
