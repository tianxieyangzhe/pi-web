import type { WorkspaceRecord, WorkspaceSessionDTO, WorkspaceConfiguration } from '../../src/domain/workspace';
import type { DirectoryListing } from '../../src/application/ports/workspace';
import type { SessionTree, ProjectFileListing } from '../domain/models';
import type { NativeContextInspection } from '../domain/native-context';
async function request<T>(url:string,method='GET',body?:unknown,headers?:Record<string,string>):Promise<T> {
  const response=await fetch(url,{method,cache:'no-store',headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(method==='GET'?{}:{'idempotency-key':crypto.randomUUID()}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error?.message??'工作区请求失败');return payload.data;
}
const base=(id:string)=>`/api/workspaces/${encodeURIComponent(id)}`;
const session=(id:string,sid:string)=>`${base(id)}/sessions/${encodeURIComponent(sid)}`;
export const workspaceApi={
  base,session,
  list:()=>request<WorkspaceRecord[]>('/api/workspaces'),
  get:(id:string)=>request<WorkspaceRecord>(base(id)),
  save:(id:string|null,body:WorkspaceConfiguration,etag?:string,key=crypto.randomUUID())=>request<WorkspaceRecord>(id?base(id):'/api/workspaces',id?'PUT':'POST',{name:body.name,projects:body.projects.map(({id,rootPath})=>({...(id?{id}:{}),rootPath})),defaultProjectIndex:body.defaultProjectIndex},{'idempotency-key':key,...(etag?{'if-match':etag}:{})}),
  directories:(path?:string)=>request<DirectoryListing>(`/api/workspaces/directories${path?'?path='+encodeURIComponent(path):''}`),
  sessions:(id:string)=>request<WorkspaceSessionDTO[]>(`${base(id)}/sessions`),
  createSession:(id:string,defaultProjectId?:string)=>request<WorkspaceSessionDTO>(`${base(id)}/sessions`,'POST',defaultProjectId?{defaultProjectId}:{}),
  deleteSession:(id:string,sid:string)=>request<{deleted:boolean;sessionId:string}>(session(id,sid),'DELETE'),
  messages:(id:string,sid:string)=>request<SessionTree>(`${session(id,sid)}/messages`),
  action:(id:string,sid:string,action:string,body?:unknown)=>request<WorkspaceSessionDTO>(`${session(id,sid)}/${action}`,'POST',body),
  recover:(id:string,sid:string,action:'inspect'|'acknowledge-unknown')=>request<{pending:Array<{key:string;hash:string}>;sessionId:string}>(`${session(id,sid)}/recover`,'POST',{action}),
  models:(id:string,sid:string,lease?:string)=>request<import('../../src/domain/session-tools').SessionModelView>(`${session(id,sid)}/models`,'GET',undefined,lease?{'x-session-lease-id':lease}:{}),
  switchModel:(id:string,sid:string,provider:string,modelId:string,lease:string,thinkingLevel?:import('../../src/domain/session-tools').SessionThinkingLevel)=>request<import('../../src/domain/session-tools').SessionModelView>(`${session(id,sid)}/model`,'PUT',{provider,modelId,thinkingLevel},{'x-session-lease-id':lease}),
  context:(id:string,sid:string)=>request<NativeContextInspection>(`${session(id,sid)}/context`),
  compact:async(id:string,sid:string,cancel=false)=>{await request(`${session(id,sid)}/compact${cancel?'/cancel':''}`,'POST');return workspaceApi.context(id,sid);},
  readFile:(id:string,projectId:string,path:string)=>request<import('../domain/models').FilePreview>(`${base(id)}/projects/${encodeURIComponent(projectId)}/files/content?path=${encodeURIComponent(path)}`),
  files:(id:string,projectId:string,path='')=>request<ProjectFileListing>(`${base(id)}/projects/${projectId}/files?path=${encodeURIComponent(path)}`),
};
