import { DomainError, isKnownMessageFailure } from '@/domain/errors';
import {requireRole} from '@/domain/agent-definition';
import type {SessionCatalogPort} from './ports/core';
import type { JsonObject, Session } from '@/domain/models';
import { sessionThinkingLevels, type SessionThinkingLevel, type SessionModelView, type SessionOperation, type RecoveryView } from '@/domain/session-tools';
import type { SessionRepositoryPort } from './ports/core';
import type { ProjectRepositoryPort } from './ports/catalog';
import type { ProjectOperationStore, OperationRecord } from './ports/project-operations';
import type { PiRuntimePort, SessionRuntimeInput } from './ports/pi-runtime';
import type { SessionToolsRuntimePort } from './ports/session-tools';
import { createdSessionId, canonical, hash, operationIdentity } from '@/domain/project-operations';
import { releaseSession, assertSessionAvailable, acquireSession, sessionLocks } from './session-lock';
import { exactFields } from './project-session-service';

type Execution = { steer?:(id:string,content:string)=>Promise<void>; assertLease:(id:string,lease:string|null)=>void; hasLease:(id:string)=>boolean; open:(id:string,key:string,readOnly?:boolean)=>Promise<unknown>; interrupt:(id:string)=>Promise<void>; restore:(id:string)=>Promise<Session>; deleteSession?:(projectId:string,id:string)=>Promise<unknown>; accept:(id:string,content:string,references?:unknown,onSettled?:(error?:unknown)=>void,webSearch?:boolean,toolSearch?:boolean)=>{accepted:boolean;sessionId:string}; };
export function createSessionToolsService(d: {
  sessions:SessionRepositoryPort; projects:ProjectRepositoryPort; runtime:PiRuntimePort & SessionToolsRuntimePort;
  operations:ProjectOperationStore; execution:Execution; assertWritable:()=>void;
  present:(session:Session)=>unknown; catalog:SessionCatalogPort; externalRunning?:(operationId:string)=>boolean;
}) {
  const active = new Map<string,Promise<unknown>>();
  const isRunning=(id:string)=>active.has(id)||!!d.externalRunning?.(id);
  function scope(projectId:string,id:string,allowDeleting=false):SessionRuntimeInput {
    const session=d.sessions.get(id),project=d.projects.get(projectId);
    if(!session||!project||session.projectId!==projectId)throw new DomainError('NOT_FOUND','会话不存在',404,true);
    if(!allowDeleting)assertSessionAvailable(id);
    return {session,workingDirectory:project.rootPath,allowProjectRead:true,allowProjectWrite:true,nativeCodingTools:true,projectSession:true};
  }
  function persistentETag(value:Session){return String((d.present(value) as {writeETag?:string}).writeETag??hash(canonical({id:value.id,projectId:value.projectId,purpose:value.purpose,agentId:value.agentId,endedAt:value.endedAt??null,updatedAt:value.updatedAt??null})));}
  function pending(projectId:string,id:string) { return d.operations.list(projectId,id).filter(record=>!['completed','failed','acknowledged'].includes(record.phase)); }
  function assertKnown(projectId:string,id:string,except?:string) {if(pending(projectId,id).some(record=>record.operationId!==except&&!isRunning(record.operationId)))throw new DomainError('REQUEST_UNKNOWN','请先核对未决操作',409,true);}
  function editable(input:SessionRuntimeInput) {if(d.projects.get(input.session.projectId)?.status!=='active')throw new DomainError('PROJECT_UNAVAILABLE','项目当前不可用',409,true);}
  function run<T>(projectId:string,id:string,operation:SessionOperation,key:string,payload:unknown,work:(input:SessionRuntimeInput,observe:(evidence:JsonObject)=>void,record:OperationRecord)=>Promise<T>,replay:(record:OperationRecord)=>T|Promise<T>,control=false):Promise<T> {
    const input=scope(projectId,id);d.assertWritable();
    const operationId=operationIdentity(projectId,id,operation,key);
    const prior=d.operations.read(projectId,operationId).at(-1);
    if(prior&&prior.payloadSha256!==hash(canonical(payload)))throw new DomainError('IDEMPOTENCY_CONFLICT','同一请求键不能用于不同内容',409,true);
    const running=active.get(operationId);if(running)return running as Promise<T>;
    if(prior?.phase==='completed')return Promise.resolve(replay(prior));
    if(prior?.phase==='failed')throw new DomainError(String(prior.evidence.errorCode??'RUNTIME_ERROR'),'此前操作已失败，请使用新请求键',409,true);
    if(prior)throw new DomainError('REQUEST_UNKNOWN','此前操作结果待核对，不能重放',409,true);
    assertKnown(projectId,id);
    if(!control)acquireSession(id);
    const promise=(async()=>{
      let record:OperationRecord|undefined;
      try {
        record=d.operations.prepare(projectId,id,operation,key,payload,{baseline:d.runtime.operationEvidence(input),sourceWriteETag:persistentETag(input.session),...(['fork','switch-model','adopt-agent'].includes(operation)?{intent:payload as JsonObject}:{})});
        const result=await work(input,evidence=>{record=d.operations.append(record!,'observed',evidence);},record);
        record=d.operations.append(record,'completed',{resultSessionId:record.evidence.resultSessionId??id});
        return result;
      }catch(error){if(error instanceof DomainError&&record){if(record.phase==='prepared'&&((error as DomainError&{noSideEffects?:boolean}).noSideEffects===true||['NOT_FOUND','NO_NATIVE_REF','FORK_NODE_UNSUPPORTED','INVALID_INPUT','WRITE_CONFLICT','PRECONDITION_REQUIRED','PROJECT_UNAVAILABLE','SESSION_ENDED','RUNTIME_NOT_OPEN','NOTHING_TO_COMPACT','ROLE_BINDING_INVALID','ROLE_UNAVAILABLE','SESSION_BUSY','SESSION_NOT_RUNNING','SESSION_NOT_UNAVAILABLE'].includes(error.code))){try{d.operations.append(record,'failed',{errorCode:error.code});}catch{}}Object.assign(error,{operationId:record.operationId});}if(record&&!(error instanceof DomainError))throw Object.assign(new DomainError('REQUEST_UNKNOWN','操作结果待核对，未自动重放',409,true),{operationId:record.operationId});throw error;}
      finally{if(!control)releaseSession(id);active.delete(operationId);}
    })();
    active.set(operationId,promise);return promise;
  }
  async function modelView(projectId:string,id:string,lease?:string|null):Promise<SessionModelView> {
    const input=scope(projectId,id),view=await d.runtime.models(input);
    let reason:string|null=null;
    try{d.assertWritable();assertKnown(projectId,id);editable(input);if(sessionLocks.has(id))throw new DomainError('SESSION_BUSY','会话正在运行',409,true);if(lease)d.execution.assertLease(id,lease);else if(!d.execution.hasLease(id))throw new DomainError('RUNTIME_NOT_OPEN','请先打开会话',409,true);}catch(error){reason=error instanceof DomainError?error.code:'REQUEST_UNKNOWN';}
    return {...view,canSwitch:reason===null,unavailableReason:reason};
  }
  return {
    running:isRunning,assertKnown,
    models:modelView,
    switchModel(projectId:string,id:string,body:Record<string,unknown>,key:string,lease:string|null) {
      exactFields(body,['provider','modelId','thinkingLevel']);
      if(body.thinkingLevel!==undefined&&!sessionThinkingLevels.includes(body.thinkingLevel as SessionThinkingLevel))throw new DomainError('INVALID_INPUT','思考等级无效',400,true);
      if(typeof body.provider!=='string'||!body.provider||body.provider.length>1024||typeof body.modelId!=='string'||!body.modelId||body.modelId.length>1024)throw new DomainError('INVALID_INPUT','请选择有效模型',400,true);
      const identity={provider:body.provider,modelId:body.modelId,...(body.thinkingLevel!==undefined?{thinkingLevel:body.thinkingLevel as SessionThinkingLevel}:{})};
      d.execution.assertLease(id,lease);
      return run(projectId,id,'switch-model',key,identity,async(input,observe)=>{editable(input);await d.runtime.switchModel(input,identity);d.sessions.updateRuntime(id,{state:"idle"});observe({after:d.runtime.operationEvidence(input),target:identity});return modelView(projectId,id,lease);},()=>modelView(projectId,id,lease));
    },
    adoptAgent(projectId:string,id:string,body:Record<string,unknown>,key:string,etag:string|null) {
      exactFields(body,['agentId','revision','contentSha256']);
      if(typeof body.agentId!=='string'||!Number.isInteger(body.revision)||Number(body.revision)<1||typeof body.contentSha256!=='string'||!/^[a-f0-9]{64}$/.test(body.contentSha256))throw new DomainError('INVALID_INPUT','Agent版本引用无效',400,true);
      if(!etag)throw new DomainError('PRECONDITION_REQUIRED','缺少If-Match',428,true);
      return run(projectId,id,'adopt-agent',key,body,async(input,observe)=>{
        editable(input);if((d.present(input.session) as {writeETag:string}).writeETag!==etag)throw new DomainError('WRITE_CONFLICT','会话已变化，请重新读取',409,true);
        if(input.session.agentId!==body.agentId)throw new DomainError('ROLE_BINDING_INVALID','只能采用同一Agent的新版本',409,true);
        const role=requireRole(d.catalog.getAgentVersion(body.agentId as string,Number(body.revision),String(body.contentSha256)),'project',projectId);
        if(!d.sessions.adoptAgent)throw new DomainError('SCHEMA_INCOMPATIBLE','会话版本写入能力不可用',409,true);
        const result=d.sessions.adoptAgent(id,input.session,role);observe({afterWriteETag:persistentETag(result),agentSnapshot:{agentId:role.agentId,revision:role.revision,contentSha256:role.contentSha256}});return d.present(result);
      },()=>d.present(d.sessions.get(id)!));
    },
    fork(projectId:string,id:string,body:Record<string,unknown>,key:string) {
      exactFields(body,['entryId']);if(typeof body.entryId!=='string'||!body.entryId||body.entryId.length>128)throw new DomainError('INVALID_INPUT','请选择有效节点',400,true);
      const entryId=body.entryId,newId=createdSessionId(projectId,key,id);
      return run(projectId,id,'fork',key,{entryId},async(input,observe,record)=>{
        if(d.projects.get(projectId)?.status!=='active')throw new DomainError('PROJECT_UNAVAILABLE','项目当前不可用',409,true);
        const nativeRef=await d.runtime.fork(input,entryId,d.operations.directory(record));
        const candidateEvidence=d.runtime.validateForkCandidate(input,nativeRef,entryId);
        observe({candidateRef:nativeRef,candidateEvidence,resultSessionId:newId,entryId});
        const created=d.sessions.create({projectId,purpose:input.session.purpose,agentId:input.session.agentId,agentSnapshot:input.session.agentSnapshot,mcpIds:[],mcpSnapshots:[],stableId:newId,nativeRef,createRequestKeyHash:record.operationId,createRequestSha256:record.payloadSha256});
        return d.present(created);
      },record=>{const result=d.sessions.get(String(record.evidence.resultSessionId));if(!result)throw new DomainError('RESULT_GONE','派生会话已删除',410,true);if(result.projectId!==projectId||result.createRequestKeyHash!==record.operationId||result.createRequestSha256!==record.payloadSha256||canonical(result.nativeRef)!==canonical(record.evidence.candidateRef))throw new DomainError('REQUEST_UNKNOWN','派生结果身份不一致',409,true);return d.present(result);});
    },
    async export(projectId:string,id:string,format:string,range:string) {
      if(!['html','jsonl'].includes(format)||!['tree','branch'].includes(range))throw new DomainError('INVALID_INPUT','导出格式或范围无效',400,true);
      try{return await d.runtime.export(scope(projectId,id),format as 'html'|'jsonl',range as 'tree'|'branch');}catch(error){if(error instanceof DomainError&&['NOT_FOUND','NO_NATIVE_REF'].includes(error.code))throw error;throw new DomainError('SESSION_EXPORT_FAILED','无法生成完整导出，请重试或核对原生历史',500,true);}
    },
    async open(projectId:string,id:string,key:string) {
      const input=scope(projectId,id);
      operationIdentity(projectId,id,'open',key);
      let readOnlyReason:string|null=null;try{d.assertWritable();assertKnown(projectId,id);}catch(error){if(error instanceof DomainError&&['SCHEMA_INCOMPATIBLE','REQUEST_UNKNOWN'].includes(error.code))readOnlyReason=error.code;else throw error;}
      if(readOnlyReason){const result=await d.execution.open(id,key,true);return readOnlyReason?{...result as object,status:'unavailable',outcome:readOnlyReason}:result;}
      return run(projectId,id,'open',key,{},async(_input,observe)=>{const result=await d.execution.open(id,key);observe({after:d.runtime.operationEvidence({...input,session:d.sessions.get(id)!})});return result;},()=>d.execution.open(id,key),true);
    },
    accept(projectId:string,id:string,body:Record<string,unknown>,key:string,lease:string|null) {
      exactFields(body,['content','references','webSearch','toolSearch']);
      for(const field of ['webSearch','toolSearch'])if(body[field]!==undefined&&typeof body[field]!=='boolean')throw new DomainError('INVALID_INPUT',`${field}必须为布尔值`,400,true);
      if(typeof body.content!=='string'||!body.content.trim())throw new DomainError('INVALID_INPUT','消息不能为空',400,true);
      if(Buffer.byteLength(body.content)>32768)throw new DomainError('REQUEST_TOO_LARGE','消息不得超过32KiB',413,true);
      const input=scope(projectId,id);d.execution.assertLease(id,lease);d.assertWritable();editable(input);
      const operationId=operationIdentity(projectId,id,'message',key),payload={content:body.content,references:body.references??[],...(body.webSearch===true?{webSearch:true}:{}),...(body.toolSearch===true?{toolSearch:true}:{})};
      const prior=d.operations.read(projectId,operationId).at(-1);
      if(prior&&prior.payloadSha256!==hash(canonical(payload)))throw new DomainError('IDEMPOTENCY_CONFLICT','请求键已用于不同消息',409,true);
      if(prior){if(prior.phase==='completed'||active.has(operationId))return {accepted:true,sessionId:id,operationId};if(prior.phase==='failed')throw new DomainError(String(prior.evidence.errorCode??'RUNTIME_ERROR'),'此前请求已失败，请使用新请求键重试',422,true);throw new DomainError('REQUEST_UNKNOWN','此前请求结果待核对',409,true);}
      assertKnown(projectId,id);if(sessionLocks.has(id))throw new DomainError('SESSION_BUSY','会话正在执行',409,true);
      if(!d.runtime.getHandle(id))throw new DomainError('RUNTIME_NOT_OPEN','会话运行连接已失效，请重新连接后发送，输入和文件将保留',409,true);
      if(body.webSearch===true){const handle=d.runtime.getHandle(id);if(!handle||!d.runtime.validateWebSearch)throw new DomainError('WEB_SEARCH_UNSUPPORTED','当前运行时不支持服务端搜索，请关闭联网搜索',422,true);d.runtime.validateWebSearch(handle);}
      if(body.toolSearch===true){if(!d.runtime.validateToolSearch)throw new DomainError('TOOL_SEARCH_UNAVAILABLE','当前运行时未装配工具搜索，请关闭工具搜索或重启服务',422,true);d.runtime.validateToolSearch();}
      let record=d.operations.prepare(projectId,id,'message',key,payload,{baseline:d.runtime.operationEvidence(input)});
      let finish!:()=>void;const done=new Promise<void>(resolve=>{finish=resolve;});active.set(operationId,done);
      try {
        d.execution.accept(id,body.content,body.references,error=>{
          try {
            if(!error||error instanceof DomainError&&error.code==='REQUEST_ABORTED'){
              record=d.operations.append(record,'observed',{after:d.runtime.operationEvidence({...input,session:d.sessions.get(id)!}),settled:true,...(error instanceof DomainError?{errorCode:error.code}:{})});
              d.operations.append(record,'completed',{resultSessionId:id});
            }else if(isKnownMessageFailure(error)){
              record=d.operations.append(record,'observed',{after:d.runtime.operationEvidence({...input,session:d.sessions.get(id)!}),...(error.noSideEffects?{notStarted:true}:{settled:true}),errorCode:error.code});
              d.operations.append(record,'failed',{errorCode:error.code});
            }
          }catch{/* A missing receipt remains unknown; never replay it. */}finally{active.delete(operationId);finish();}
        },body.webSearch===true,body.toolSearch===true);
      }catch(error){active.delete(operationId);finish();throw error;}
      return {accepted:true,sessionId:id,operationId};
    },
    steer(projectId:string,id:string,body:Record<string,unknown>,key:string,lease:string|null) {
      exactFields(body,['content']);
      if(typeof body.content!=='string'||!body.content.trim())throw new DomainError('INVALID_INPUT','纠正内容不能为空',400,true);
      if(Buffer.byteLength(body.content)>32768)throw new DomainError('REQUEST_TOO_LARGE','纠正内容不得超过32KiB',413,true);
      const input=scope(projectId,id);d.execution.assertLease(id,lease);editable(input);
      const content=body.content,operationId=operationIdentity(projectId,id,'steer',key);
      const result=()=>({accepted:true,sessionId:id,operationId,delivery:'steer' as const});
      return run(projectId,id,'steer',key,{content},async(_input,observe)=>{
        if(!d.execution.steer)throw new DomainError('SESSION_NOT_RUNNING','当前运行时不支持纠正',409,true);
        await d.execution.steer(id,content);
        observe({queued:true});return result();
      },result,true);
    },
    async delete(projectId:string,id:string){scope(projectId,id,true);d.assertWritable();if(!d.execution.deleteSession)throw new DomainError('SCHEMA_INCOMPATIBLE','删除能力不可用',409,true);return d.execution.deleteSession(projectId,id);},
    interrupt(projectId:string,id:string,key:string) {
      return run(projectId,id,'interrupt',key,{},async(input,observe)=>{const parent=pending(projectId,id).find(record=>record.operation==='message'&&active.has(record.operationId));if(!parent)throw new DomainError('SESSION_NOT_RUNNING','没有可确认的主请求',409,true);observe({parentOperationId:parent.operationId});await d.execution.interrupt(id);observe({parentOperationId:parent.operationId,settled:true,after:d.runtime.operationEvidence({...input,session:d.sessions.get(id)!})});return d.present(d.sessions.get(id)!);},()=>d.present(d.sessions.get(id)!),true);
    },
    restore(projectId:string,id:string,key:string) {
      return run(projectId,id,'restore',key,{},async(input,observe)=>{const restored=await d.execution.restore(id);observe({after:d.runtime.operationEvidence({...input,session:restored}),settled:true});return d.present(restored);},()=>d.present(d.sessions.get(id)!),true);
    },
    async recoverCreate(projectId:string,operationId:string,body:Record<string,unknown>,key?:string):Promise<RecoveryView>{
      exactFields(body,['operationId','action']);if(body.operationId!==operationId||!['inspect','acknowledge-unknown'].includes(String(body.action)))throw new DomainError('INVALID_INPUT','创建恢复请求无效',400,true);
      if(!d.projects.get(projectId))throw new DomainError('NOT_FOUND','项目不存在',404,true);
      const record=d.operations.read(projectId,operationId).at(-1);if(!record||record.operation!=='create')throw new DomainError('NOT_FOUND','创建请求不存在',404,true);
      const row=d.sessions.get(record.sessionId);let status:RecoveryView['status']=record.phase==='completed'?'completed':record.phase==='failed'?'failed':record.phase==='acknowledged'?'acknowledged':'unknown';
      if(row){if(row.projectId!==projectId||row.createRequestKeyHash!==record.operationId||row.createRequestSha256!==record.payloadSha256)throw new DomainError('REQUEST_UNKNOWN','创建业务身份冲突',409,true);status='completed';}
      else if(record.phase==='completed')throw new DomainError('RESULT_GONE','创建结果已被删除',410,true);
      const canAcknowledge=!row&&!['completed','failed','acknowledged'].includes(record.phase);
      if(body.action!=='inspect'){
        d.assertWritable();if(!key)throw new DomainError('INVALID_IDEMPOTENCY_KEY','恢复修改要求请求键',400,true);
        const recovery=d.operations.prepare(projectId,record.sessionId,'recover',key,{operationId,action:body.action});
        if(recovery.phase!=='completed'){if(!canAcknowledge)throw new DomainError('REQUEST_UNKNOWN','当前不能确认此创建请求',409,true);d.operations.append(record,'acknowledged');d.operations.append(recovery,'completed');}status='acknowledged';
      }
      return {operationId,operation:'create',status,resultSessionId:row?.id??null,errorCode:status==='unknown'?'REQUEST_UNKNOWN':null,allowedRecovery:{acknowledgeUnknown:canAcknowledge,finalizeFork:false}};
    },
    async recover(projectId:string,id:string,body:Record<string,unknown>,key?:string):Promise<RecoveryView> {
      exactFields(body,['operationId','action']);
      if(typeof body.operationId!=='string'||!['inspect','acknowledge-unknown','finalize-fork'].includes(String(body.action)))throw new DomainError('INVALID_INPUT','恢复请求无效',400,true);
      const input=scope(projectId,id),records=d.operations.read(projectId,body.operationId),record=records.at(-1);
      if(!record||record.sessionId!==id)throw new DomainError('NOT_FOUND','操作不存在',404,true);
      const isActive=isRunning(record.operationId),terminal=['completed','failed','acknowledged'].includes(record.phase);
      const after=record.evidence.after as JsonObject|undefined,baseline=records[0].evidence.baseline as JsonObject|undefined;
      const evidence=d.runtime.operationEvidence(input);
      const sameBaseline=baseline&&canonical(baseline)===canonical(evidence);
      const candidate=record.evidence.candidateRef as JsonObject|undefined;
      let candidateValid=false;
      if(record.operation==='fork'&&candidate&&sameBaseline&&records[0].evidence.sourceWriteETag===persistentETag(input.session)&&typeof record.evidence.entryId==='string'){try{const verified=d.runtime.validateForkCandidate(input,candidate,record.evidence.entryId);candidateValid=canonical(verified)===canonical(record.evidence.candidateEvidence);}catch{}}
      const resultId=typeof record.evidence.resultSessionId==='string'?record.evidence.resultSessionId:null;
      let status:RecoveryView['status']=isActive?'running':terminal?record.phase as 'completed'|'failed'|'acknowledged':'unknown';
      if(!terminal&&!isActive&&record.operation==='switch-model'&&after&&canonical(after)===canonical(evidence))status='completed';
      if(!terminal&&!isActive&&record.operation==='fork'&&candidateValid&&resultId){const row=d.sessions.get(resultId);if(row&&row.createRequestKeyHash===record.operationId&&row.createRequestSha256===record.payloadSha256&&canonical(row.nativeRef)===canonical(candidate))status='completed';}
      const canAcknowledge=!terminal&&!isActive&&!sessionLocks.has(id)&&!!input.session.nativeRef;
      if(body.action!=='inspect') {
        if(!key)throw new DomainError('INVALID_IDEMPOTENCY_KEY','恢复修改要求请求键',400,true);
        d.assertWritable();if(isActive||sessionLocks.has(id))throw new DomainError('SESSION_BUSY','会话操作尚未结束',409,true);
        const recoveryId=operationIdentity(projectId,id,'recover',key);
        if(pending(projectId,id).some(other=>other.operationId!==record.operationId&&other.operationId!==recoveryId&&other.evidence.parentOperationId!==record.operationId&&other.evidence.targetOperationId!==record.operationId))throw new DomainError('REQUEST_UNKNOWN','仍有其他独立未决操作需要核对',409,true);
        const recovery=d.operations.prepare(projectId,id,'recover',key,{operationId:record.operationId,action:body.action},{targetOperationId:record.operationId});
        if(recovery.phase!=='completed'){
          acquireSession(id);
          try {
            if(terminal&&((record.phase==='acknowledged'&&body.action==='acknowledge-unknown')||(record.phase==='completed'&&body.action==='finalize-fork'))){status=record.phase==='completed'?'completed':'acknowledged';}
            else if(body.action==='finalize-fork'){
              if(!candidateValid||!resultId||d.projects.get(projectId)?.status!=='active')throw new DomainError('REQUEST_UNKNOWN','候选无法安全提交',409,true);
              const existing=d.sessions.get(resultId);
              if(existing&&(existing.createRequestKeyHash!==record.operationId||existing.createRequestSha256!==record.payloadSha256||canonical(existing.nativeRef)!==canonical(candidate)))throw new DomainError('REQUEST_UNKNOWN','候选业务身份冲突',409,true);
              if(!existing)d.sessions.create({projectId,purpose:input.session.purpose,agentId:input.session.agentId,agentSnapshot:input.session.agentSnapshot,mcpIds:[],mcpSnapshots:[],stableId:resultId,nativeRef:candidate!,createRequestKeyHash:record.operationId,createRequestSha256:record.payloadSha256});
              if(!terminal)d.operations.append(record,'completed',{resultSessionId:resultId});status='completed';
            }else{if(!canAcknowledge)throw new DomainError('REQUEST_UNKNOWN','当前不能解除未知结果门禁',409,true);d.operations.append(record,'acknowledged',{acknowledgementOperationId:recovery.operationId});status='acknowledged';}
            d.operations.append(recovery,'completed',{resultSessionId:resultId??id});
          }finally{releaseSession(id);}
        } else status=body.action==='finalize-fork'?'completed':'acknowledged';
      }
      return {operationId:record.operationId,operation:record.operation,status,resultSessionId:resultId,errorCode:status==='unknown'?'REQUEST_UNKNOWN':null,allowedRecovery:{acknowledgeUnknown:canAcknowledge,finalizeFork:!!candidateValid&&!isActive&&!terminal}};
    },
  };
}
