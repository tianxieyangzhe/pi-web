import {DomainError} from "@/domain/errors";
import {emptyInspection,type NativeContextInspection} from "@/domain/native-context";
import type {SessionRepositoryPort} from "./ports/core";
import type {ProjectRepositoryPort} from "./ports/catalog";
import type {PiRuntimePort,PiSessionHandle} from "./ports/pi-runtime";
import type {PiContextPort} from "./ports/pi-context";
import {acquireSession,sessionLocks} from "./session-lock";

type CompactionOperation={running:boolean;cancelRequested:boolean;cancelled:boolean;error:string|null;handle?:PiSessionHandle};
export function createNativeContextService(deps:{sessions:SessionRepositoryPort;projects:ProjectRepositoryPort;runtime:PiRuntimePort & PiContextPort;assertWritable:()=>void}) {
  const operations=new Map<string,CompactionOperation>();
  function scope(projectId:string,sessionId:string){
    const session=deps.sessions.get(sessionId),project=deps.projects.get(projectId);
    if(!session||!project||session.projectId!==projectId)throw new DomainError("NOT_FOUND","Session 不存在",404,true);
    return {session,project,input:{session,workingDirectory:project.rootPath,allowProjectWrite:false,projectSession:true}};
  }
  async function inspect(projectId:string,sessionId:string):Promise<NativeContextInspection>{
    const value=scope(projectId,sessionId);
    let result:NativeContextInspection;
    try{result=await deps.runtime.inspect(value.input);}catch{result=emptyInspection("原生 Session 无法恢复");}
    const operation=operations.get(sessionId);
    result.sessionState=value.session.state;
    result.compactionState=operation?.running?"running":operation?.error?"failed":operation?.cancelled?"cancelled":"idle";
    result.canCancelCompaction=!!operation?.running&&!!operation.handle&&!operation.cancelRequested&&value.project.status==="active";
    result.error=operation?.error?{code:"COMPACTION_FAILED",message:operation.error,recoverable:true}:null;
    if(value.project.status!=="active"||!value.session.sessionMemoryId||sessionLocks.has(sessionId)){
      result.canCompact=false;
      result.unavailableReason=operation?.running?(operation.cancelRequested?"正在取消压缩":"正在压缩上下文"):"项目只读或 Session 正在回答";
    }
    return result;
  }
  return {
    inspect,
    async compact(projectId:string,sessionId:string){
      deps.assertWritable();const value=scope(projectId,sessionId);
      if(value.project.status!=="active"||value.session.state!=="idle"||!value.session.nativeRef)throw new DomainError("SESSION_BUSY","Session 当前不能压缩",409,true);
      acquireSession(sessionId);
      const operation:CompactionOperation={running:true,cancelRequested:false,cancelled:false,error:null};operations.set(sessionId,operation);
      try{
        let handle=deps.runtime.getHandle(sessionId);if(!handle)handle=await deps.runtime.restore(value.input);
        const preflight=await deps.runtime.inspect(value.input);
        if(!preflight.canCompact)throw new DomainError("NOTHING_TO_COMPACT",preflight.unavailableReason??"原生会话无需压缩",409,true);
        operation.handle=handle;
        void deps.runtime.compact(handle).catch(error=>{
          if(operation.cancelRequested)operation.cancelled=true;
          else operation.error=error instanceof DomainError?error.message:"原生压缩失败，请检查恢复状态后手动重试";
        }).finally(()=>{operation.running=false;sessionLocks.delete(sessionId);});
      }catch(error){operation.running=false;sessionLocks.delete(sessionId);throw error;}
      return inspect(projectId,sessionId);
    },
    async cancel(projectId:string,sessionId:string){
      deps.assertWritable();const value=scope(projectId,sessionId),operation=operations.get(sessionId);
      if(value.project.status!=="active")throw new DomainError("PROJECT_UNAVAILABLE","项目只读，不能操作",409,true);
      if(!operation?.running||!operation.handle)throw new DomainError("COMPACTION_NOT_RUNNING","当前没有正在运行的压缩",409,true);
      if(!operation.cancelRequested){deps.runtime.cancelCompaction(operation.handle);operation.cancelRequested=true;}
      // The original operation owns lock release; cancellation never releases it early.
      return inspect(projectId,sessionId);
    },
  };
}
