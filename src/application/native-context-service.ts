import {DomainError} from '@/domain/errors';
import {operationIdentity} from '@/domain/project-operations';
import {emptyInspection,type NativeContextInspection} from '@/domain/native-context';
import type {SessionRepositoryPort} from './ports/core';
import type {ProjectRepositoryPort} from './ports/catalog';
import type {PiRuntimePort,PiSessionHandle} from './ports/pi-runtime';
import type {PiContextPort} from './ports/pi-context';
import type {ProjectOperationStore,OperationRecord} from './ports/project-operations';
import type {SessionToolsRuntimePort} from './ports/session-tools';
import {acquireSession,sessionLocks} from './session-lock';

type CompactionOperation={running:boolean;cancelRequested:boolean;cancelled:boolean;error:string|null;handle?:PiSessionHandle;record?:OperationRecord;cancelRecord?:OperationRecord};
export function createNativeContextService(deps:{sessions:SessionRepositoryPort;projects:ProjectRepositoryPort;runtime:PiRuntimePort & PiContextPort & Partial<SessionToolsRuntimePort>;assertWritable:()=>void;operations?:ProjectOperationStore;changed?:(id:string)=>void;assertLease?:(id:string,lease:string|null)=>void;assertKnown?:(projectId:string,id:string)=>void}) {
  const operations=new Map<string,CompactionOperation>();
  function scope(projectId:string,sessionId:string){
    const session=deps.sessions.get(sessionId),project=deps.projects.get(projectId);
    if(!session||!project||session.projectId!==projectId)throw new DomainError('NOT_FOUND','Session 不存在',404,true);
    return {session,project,input:{session,workingDirectory:project.rootPath,allowProjectWrite:false,projectSession:true}};
  }
  async function inspect(projectId:string,sessionId:string):Promise<NativeContextInspection>{
    const value=scope(projectId,sessionId);let result:NativeContextInspection;
    try{result=await deps.runtime.inspect(value.input);}catch{result=emptyInspection('原生 Session 无法恢复');}
    const operation=operations.get(sessionId);
    result.sessionState=value.session.state;
    result.compactionState=operation?.running?'running':operation?.error?'failed':operation?.cancelled?'cancelled':'idle';
    result.canCancelCompaction=!!operation?.running&&!!operation.handle&&!operation.cancelRequested;
    result.error=operation?.error?{code:'COMPACTION_FAILED',message:operation.error,recoverable:true}:null;
    let unknown=false;try{deps.assertKnown?.(projectId,sessionId);}catch{unknown=true;}
    if(value.project.status!=='active'||sessionLocks.has(sessionId)||unknown){result.canCompact=false;result.unavailableReason=operation?.running?(operation.cancelRequested?'正在取消压缩':'正在压缩上下文'):unknown?'REQUEST_UNKNOWN':'项目只读或 Session 正在回答';}
    return result;
  }
  return {
    inspect,
    running:(operationId:string)=>[...operations.values()].some(value=>value.running&&(value.record?.operationId===operationId||value.cancelRecord?.operationId===operationId)),
    async compact(projectId:string,sessionId:string,key:string,lease:string|null=null){
      deps.assertWritable();const value=scope(projectId,sessionId);deps.assertLease?.(sessionId,lease);
      if(value.project.status!=='active'||!value.session.nativeRef)throw new DomainError('SESSION_BUSY','Session 当前不能压缩',409,true);
      const current=operations.get(sessionId),operationId=operationIdentity(projectId,sessionId,'compact',key);
      const prior=deps.operations?.read(projectId,operationId).at(-1);
      if(prior?.phase==='completed'||current?.running&&current.record?.operationId===operationId)return {operationId,inspection:await inspect(projectId,sessionId)};
      if(prior)throw new DomainError('REQUEST_UNKNOWN','此前压缩结果待核对',409,true);
      deps.assertKnown?.(projectId,sessionId);acquireSession(sessionId);
      const operation:CompactionOperation={running:true,cancelRequested:false,cancelled:false,error:null};operations.set(sessionId,operation);
      try{
        const handle=deps.runtime.getHandle(sessionId);if(!handle)throw new DomainError('RUNTIME_NOT_OPEN','请先打开项目会话',409,true);
        const preflight=await deps.runtime.inspect(value.input);if(!preflight.canCompact)throw new DomainError('NOTHING_TO_COMPACT',preflight.unavailableReason??'原生会话无需压缩',409,true);
        operation.handle=handle;
        operation.record=deps.operations?.prepare(projectId,sessionId,'compact',key,{}, {baseline:deps.runtime.operationEvidence?.(value.input)??{}});
        if(operation.record&&operation.record.phase!=='prepared')throw new DomainError('REQUEST_UNKNOWN','此前压缩结果待核对，不能重放',409,true);
        void deps.runtime.compact(handle).then(()=>{
          if(operation.record&&deps.operations){operation.record=deps.operations.append(operation.record,'observed',{after:deps.runtime.operationEvidence?.(value.input)??{},settled:true});deps.operations.append(operation.record,'completed');}
          if(operation.cancelRecord&&deps.operations)deps.operations.append(operation.cancelRecord,'completed',{parentOperationId:operation.record?.operationId??null});
        }).catch(error=>{
          if(operation.cancelRequested&&error instanceof DomainError&&error.code==='REQUEST_ABORTED'){operation.cancelled=true;if(operation.record&&deps.operations){try{operation.record=deps.operations.append(operation.record,'observed',{after:deps.runtime.operationEvidence?.(value.input)??{},settled:true,cancelled:true});deps.operations.append(operation.record,'completed',{cancelled:true});if(operation.cancelRecord)deps.operations.append(operation.cancelRecord,'completed',{parentOperationId:operation.record.operationId});}catch{operation.error='REQUEST_UNKNOWN';}}}
          else operation.error=error instanceof DomainError?error.message:'原生压缩失败，请核对恢复状态后重试';
        }).finally(()=>{operation.running=false;sessionLocks.delete(sessionId);deps.changed?.(sessionId);});
      }catch(error){operation.running=false;sessionLocks.delete(sessionId);throw error;}
      return {operationId:operation.record?.operationId??'',inspection:await inspect(projectId,sessionId)};
    },
    async cancel(projectId:string,sessionId:string,key:string){
      deps.assertWritable();scope(projectId,sessionId);const operation=operations.get(sessionId),operationId=operationIdentity(projectId,sessionId,'compact-cancel',key);
      const prior=deps.operations?.read(projectId,operationId).at(-1);
      if(prior?.phase==='completed'||operation?.cancelRecord?.operationId===operationId)return {operationId,inspection:await inspect(projectId,sessionId)};
      if(prior)throw new DomainError('REQUEST_UNKNOWN','此前取消结果待核对',409,true);
      if(!operation?.running||!operation.handle)throw new DomainError('COMPACTION_NOT_RUNNING','当前没有正在运行的压缩',409,true);
      if(!operation.cancelRequested){
        operation.cancelRecord=deps.operations?.prepare(projectId,sessionId,'compact-cancel',key,{}, {parentOperationId:operation.record?.operationId??null});
        if(operation.cancelRecord&&operation.cancelRecord.phase!=='prepared')throw new DomainError('REQUEST_UNKNOWN','此前取消结果待核对',409,true);
        deps.runtime.cancelCompaction(operation.handle);operation.cancelRequested=true;
      }
      return {operationId:operation.cancelRecord?.operationId??'',inspection:await inspect(projectId,sessionId)};
    },
  };
}
