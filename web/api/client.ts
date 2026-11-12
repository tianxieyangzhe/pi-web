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

type PreparedAgent={name:string;description:string|null;definition:import('../domain/models').AgentDefinition;warnings:string[];sources:Array<{path:string;hash:string}>};
async function streamResult<T>(url:string,body:Record<string,unknown>,signal:AbortSignal,onProgress?: (event:import('../../src/application/agent-service').AgentPreparationProgress)=>void,etag?:string):Promise<T>{
  const response=await fetch(url,{...mutation('POST',body),headers:{...jsonHeaders,accept:'application/x-ndjson',...(etag?{'if-match':etag}:{})},signal});
  if(!response.ok){const payload=await response.json();throw new Error(payload.error?.message??'生成失败');}
  if(!response.body)throw new Error('生成连接不可用');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result:T|undefined;
  const line=(text:string)=>{if(!text.trim())return;const event=JSON.parse(text);if(event.type==='error')throw new Error(event.error?.message??'生成失败');if(event.type==='progress')onProgress?.(event);if(event.type==='result')result=event.data;};
  try{while(true){const {done,value}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});let index;while((index=buffer.indexOf('\n'))>=0){line(buffer.slice(0,index));buffer=buffer.slice(index+1);}if(done)break;}line(buffer);if(!result)throw new Error('生成连接已中断，草稿未更新');return result;}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

const contextRequests=new Map<string,Promise<NativeContextInspection>>();
function readNativeContext(projectId:string,sessionId:string){
  const url=`/api/projects/${projectId}/sessions/${sessionId}/context`;
  const current=contextRequests.get(url);if(current)return current;
  const pending=request<NativeContextInspection>(url).finally(()=>{if(contextRequests.get(url)===pending)contextRequests.delete(url);});
  contextRequests.set(url,pending);return pending;
}

export const api = {
  getSessionAssistant: (base:string,signal:AbortSignal) => request<import('../../src/application/ports/session-assistant').AssistantSelection>(`${base}/assistant`,{cache:'no-store',signal}),
  selectSessionAssistant: async (base:string,agentId:string,leaseId:string,signal:AbortSignal) => {
    const [view,agent]=await Promise.all([
      request<import('../../src/application/ports/session-assistant').AssistantSelection>(`${base}/assistant`,{cache:'no-store',signal}),
      request<Agent>(`/api/agents/${encodeURIComponent(agentId)}`,{cache:'no-store',signal}),
    ]);
    if(agent.status!=='active'||!agent.contentSha256)throw new Error('助手已停用或尚无正式版本');
    return request<import('../../src/application/ports/session-assistant').AssistantSelection>(`${base}/assistant`,{
      ...mutation('PUT',{selection:{agentId:agent.id,revision:agent.revision,contentSha256:agent.contentSha256}}),
      headers:{...jsonHeaders,'if-match':view.writeETag,'x-session-lease-id':leaseId},signal,
    });
  },
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
  generationSkills: (signal?:AbortSignal) => request<{defaultSkillId:string;skills:import("../../src/application/ports/generation-skills").GenerationSkillView[]}>("/api/agents/skills",{signal,cache:"no-store"}),
  prepareAgent:(body:Record<string,unknown>,signal:AbortSignal,onProgress?:(event:import('../../src/application/agent-service').AgentPreparationProgress)=>void)=>streamResult<PreparedAgent>('/api/agents/prepare',body,signal,onProgress),
  projectRules:(url:string,signal?:AbortSignal)=>request<import('../../src/application/ports/project-rule-generations').ProjectRulesStatus>(url,{signal,cache:'no-store'}),
  setProjectRules:(url:string,enabled:boolean,etag:string)=>request<import('../../src/application/ports/project-rule-generations').ProjectRulesStatus>(url,{...mutation('PUT',{enabled}),headers:{...jsonHeaders,'if-match':etag}}),
  generateProjectRules:(url:string,body:Record<string,unknown>,etag:string,key:string)=>request<import('../../src/application/ports/project-rule-generations').ProjectRulesStatus>(url,{...mutation('POST',body),headers:{...jsonHeaders,'if-match':etag,'idempotency-key':key}}),
  cancelProjectRuleGeneration:(url:string,generationId:string)=>request<import('../../src/application/ports/project-rule-generations').ProjectRulesStatus>(url,mutation('PATCH',{generationId,action:'cancel'})),
  listReferenceAgents:(context:{projectId?:string;workspaceId?:string},signal?:AbortSignal)=>request<Agent[]>(`/api/agents?${new URLSearchParams({references:'1',...context})}`,{signal,cache:'no-store'}),
  listAgents: (signal?:AbortSignal) => request<Agent[]>("/api/agents",{signal,cache:'no-store'}),
  getAgent: (id: string, signal?:AbortSignal) => request<Agent>(`/api/agents/${encodeURIComponent(id)}`,{signal,cache:'no-store'}),
  getSkill:(id:string,signal?:AbortSignal)=>request<import('../../src/application/ports/generation-skills').GenerationSkill>(`/api/agents/skills/${encodeURIComponent(id)}`,{signal,cache:'no-store'}),
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
