import { isRoleSnapshot, snapshotReference } from '@/domain/agent-definition';
import { DomainError } from '@/domain/errors';
import type { Session, JsonObject } from '@/domain/models';
import type { SessionActions, ActionName } from '@/domain/session-tools';
import type { ProjectRepositoryPort } from './ports/catalog';
import type { SessionRepositoryPort } from './ports/core';
import type { ProjectOperationStore } from './ports/project-operations';
import { canonical, createdSessionId, hash, operationIdentity } from '@/domain/project-operations';
import { assertSessionAvailable, isSessionDeleting, sessionLocks } from './session-lock';

export function exactFields(body: Record<string,unknown>, allowed: string[]) {
  if(Object.keys(body).some(key=>!allowed.includes(key)))throw new DomainError('INVALID_INPUT','请求包含不支持的字段',400,true);
}
export function parseSessionCreation(body: Record<string,unknown>) {
  exactFields(body,['agentId','purpose']);
  if(body.agentId!==undefined&&(typeof body.agentId!=='string'||!body.agentId.trim())||body.purpose!==undefined&&(typeof body.purpose!=='string'||Array.from(body.purpose).length>500))throw new DomainError('INVALID_INPUT','会话创建参数无效',400,true);
  return { agentId: typeof body.agentId==='string'?body.agentId.trim():null, purpose: typeof body.purpose==='string'?body.purpose.trim():'' };
}
export function createProjectSessionService(dependencies: {
  projects: ProjectRepositoryPort; sessions: SessionRepositoryPort; operations: ProjectOperationStore;
  role?: (agentId: string, projectId: string) => import('@/domain/models').AgentSnapshot;
  openHistory?:import('./ports/session-open-history').SessionOpenHistory;
  preview?:(session:Session)=>import('@/domain/session-preview').SessionPreview;
  hasLease?: (sessionId:string)=>boolean;
  operationRunning?: (operationId:string)=>boolean;
  writable?: ()=>boolean;
  releaseHandle?:(id:string)=>Promise<void>;
}) {
  const {projects,sessions,operations}=dependencies;
  function project(id:string,active=false) {const value=projects.get(id);if(!value)throw new DomainError('NOT_FOUND','项目不存在',404,true);if(active&&value.status!=='active')throw new DomainError('PROJECT_UNAVAILABLE','项目当前不可用',409,true);return value;}
  function get(projectId:string,id:string) {project(projectId);const value=sessions.get(id);if(!value||value.projectId!==projectId)throw new DomainError('NOT_FOUND','会话不存在',404,true);assertSessionAvailable(id);return value;}
  function pending(value:Session) {return operations.list(value.projectId,value.id).filter(record=>!['completed','failed','acknowledged'].includes(record.phase)).map(record=>({operationId:record.operationId,operation:record.operation,status:dependencies.operationRunning?.(record.operationId)?'running' as const:'unknown' as const}));}
  function present(value:Session) {
    let unresolved:ReturnType<typeof pending>=[],corrupt=false;
    try{unresolved=pending(value);}catch{corrupt=true;}
    const unknown=corrupt||unresolved.some(record=>record.status==='unknown'),busy=sessionLocks.has(value.id),active=project(value.projectId).status==='active',lease=!!dependencies.hasLease?.(value.id),compatible=dependencies.writable?.()!==false;
    const history=!!value.nativeRef;
    const permission=(name:ActionName):{allowed:boolean;reason:string|null}=>{
      let reason:string|null=null;
      if(isSessionDeleting(value.id))reason='SESSION_BUSY';
      else if(name==='delete')reason=compatible?null:'SCHEMA_INCOMPATIBLE';
      else if(name==='export')reason=history?null:'NO_NATIVE_REF';
      else if(!compatible)reason='SCHEMA_INCOMPATIBLE';
      else if(name==='interrupt')reason=['starting','running','interrupting'].includes(value.state)?null:'SESSION_NOT_RUNNING';
      else if(name==='cancelCompaction')reason=busy?null:'COMPACTION_NOT_RUNNING';
      else if(unknown)reason='REQUEST_UNKNOWN';
      else if(name==='steer')reason=!active?'PROJECT_UNAVAILABLE':!lease?'RUNTIME_NOT_OPEN':value.state==='running'&&busy?null:'SESSION_NOT_RUNNING';
      else if(busy)reason='SESSION_BUSY';
      else if(name==='fork')reason=!active?'PROJECT_UNAVAILABLE':!history?'NO_NATIVE_REF':null;
      else if(name==='restore')reason=history?null:'NO_NATIVE_REF';
      else if(!active)reason='PROJECT_UNAVAILABLE';
      else if(['send','switchModel','compact'].includes(name)&&!lease)reason='RUNTIME_NOT_OPEN';
      else if(name==='send'&&value.state==='unavailable')reason='MODEL_UNAVAILABLE';
      else if(name==='adoptAgent'&&!value.agentId)reason='ROLE_BINDING_INVALID';
      return {allowed:reason===null,reason};
    };
    const names:ActionName[]=['send','steer','interrupt','end','restore','delete','compact','cancelCompaction','switchModel','fork','export','adoptAgent'];
    const snapshot=value.agentSnapshot;
    const safeSnapshot=snapshot&&isRoleSnapshot(snapshot)?snapshotReference(snapshot):snapshot?{agentId:value.agentId!,revision:snapshot.revision,legacy:true as const}:null;
    const persisted={id:value.id,projectId:value.projectId,purpose:value.purpose,agentId:value.agentId,agentSnapshot:safeSnapshot,status:lease?'open' as const:'closed' as const,createdAt:value.createdAt,updatedAt:value.updatedAt};
    const {status:_,...facts}=persisted;
    return {...persisted,lastOpenedAt:dependencies.openHistory?.get({scope:'project',ownerId:value.projectId,sessionId:value.id})??null,...(dependencies.preview?.(value)??{lastUserInput:null,lastActivityAt:value.createdAt,previewUnavailable:false}),writeETag:'"'+hash(canonical(facts))+'"',allowedActions:Object.fromEntries(names.map(name=>[name,permission(name)])) as SessionActions,pendingOperations:unresolved};
  }
  function createRecord(projectId:string,body:Record<string,unknown>,key:string) {
    const value=project(projectId,true),input=parseSessionCreation(body),id=createdSessionId(projectId,key);
    if(dependencies.writable?.()===false)throw new DomainError('SCHEMA_INCOMPATIBLE','旧数据库只读，升级需要另行授权',409,true);
    const previous=operations.read(projectId,operationIdentity(projectId,id,'create',key)).at(-1);
    const role=previous?previous.evidence.agentSnapshot??null:input.agentId&&dependencies.role?dependencies.role(input.agentId,value.id):null;
    const record=operations.prepare(projectId,id,'create',key,input,{agentSnapshot:role&&isRoleSnapshot(role)?snapshotReference(role) as unknown as JsonObject:null});
    if(record.phase==='acknowledged')throw Object.assign(new DomainError('REQUEST_UNKNOWN','原创建请求已确认结果未知，不能重放',409,true),{operationId:record.operationId});
    if(record.phase==='failed')throw new DomainError(String(record.evidence.errorCode??'INVALID_INPUT'),'此前创建失败，请使用新请求键',409,true);
    const existing=sessions.get(id);
    if(existing){if(existing.createRequestKeyHash!==record.operationId||existing.createRequestSha256!==record.payloadSha256)throw new DomainError('REQUEST_UNKNOWN','创建身份不一致',409,true);if(record.phase==='prepared')operations.append(record,'completed',{resultSessionId:id});return present(existing);}
    if(record.phase==='completed')throw new DomainError('RESULT_GONE','原创建结果已被删除',410,true);
    if(previous)throw new DomainError('REQUEST_UNKNOWN','创建结果尚未核实，请先恢复核对',409,true);
    try{const created=sessions.create({projectId,purpose:input.purpose,agentId:input.agentId,agentSnapshot:role as import('@/domain/models').AgentSnapshot|null,mcpIds:[],mcpSnapshots:[],stableId:id,createRequestKeyHash:record.operationId,createRequestSha256:record.payloadSha256});
    operations.append(record,'completed',{resultSessionId:id});return present(created);}
    catch{throw Object.assign(new DomainError('REQUEST_UNKNOWN','创建结果待核对，未自动重建会话',409,true),{operationId:record.operationId});}
  }
  return {
    list(projectId:string){project(projectId);return sessions.listForProject(projectId).map(present);},get,
    summary(projectId:string,id:string){return present(get(projectId,id));},present,
    create: createRecord,
    async end(projectId:string,id:string,_key:string) {
      const value=get(projectId,id);
      assertSessionAvailable(id);
      if(sessionLocks.has(id))throw new DomainError('SESSION_BUSY','请先停止回答或压缩',409,true);
      if(pending(value).length)throw new DomainError('REQUEST_UNKNOWN','请先核对未决操作',409,true);
      await dependencies.releaseHandle?.(id);return present(sessions.get(id)!);
    },
  };
}
