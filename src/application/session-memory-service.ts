import {randomUUID} from "node:crypto";
import {DomainError} from "@/domain/errors";
import {contextHash,emptyContext,sessionMemoryETag,validateContext} from "@/domain/session-memory";
import type {SessionRepositoryPort} from "./ports/core";
import type {ProjectRepositoryPort} from "./ports/catalog";
import type {SessionMemoryRepositoryPort} from "./ports/session-memory";
import type {SessionMemoryHistory,SessionMemoryRuntimePort,SummaryRequest} from "./ports/session-memory-runtime";
import {sessionLocks} from "./session-lock";

type SourceRange={after:string|null;through:string};
type Job={state:"idle"|"queued"|"generating"|"failed";error:string|null;timer?:ReturnType<typeof setTimeout>;lastOutcome:string;checkAgain:boolean};
export function createSessionMemoryService(deps:{memories:SessionMemoryRepositoryPort;sessions:SessionRepositoryPort;projects:ProjectRepositoryPort;runtime:SessionMemoryRuntimePort;validatePaths?:(context:ReturnType<typeof validateContext>,root:string)=>void}) {
  const jobs=new Map<string,Job>();
  function job(id:string){let state=jobs.get(id);if(!state){state={state:"idle",error:null,lastOutcome:"none",checkAgain:false};jobs.set(id,state);}return state;}
  function scope(projectId:string,sessionId:string){
    const project=deps.projects.get(projectId),session=deps.sessions.get(sessionId);
    if(!project||!session||session.projectId!==projectId||!session.sessionMemoryId)throw new DomainError("NOT_FOUND","项目会话不存在或未绑定记忆",404,true);
    const memory=deps.memories.get(session.sessionMemoryId);
    if(!memory||memory.projectId!==projectId)throw new DomainError("MEMORY_DATA_CORRUPT","Session 与记忆归属不一致",409,true);
    return {project,session,memory,input:{session,workingDirectory:project.rootPath,allowProjectWrite:false,projectSession:true}};
  }
  function writable(projectId:string,sessionId:string){const result=scope(projectId,sessionId);if(result.project.status!=="active")throw new DomainError("PROJECT_UNAVAILABLE","项目只读，不能修改",409,true);return result;}
  async function historyOf(result:ReturnType<typeof scope>){try{return await deps.runtime.history(result.input);}catch{throw new DomainError("MEMORY_SOURCE_UNAVAILABLE","无法读取原生对话来源",409,true);}}
  function sourceIndex(history:SessionMemoryHistory,id:string|null){if(id===null)return -1;const index=history.entryIds.indexOf(id);if(index<0)throw new DomainError("MEMORY_SOURCE_CHANGED","总结来源已变更，请指定当前分支范围重新总结",409,true);return index;}
  function progress(history:SessionMemoryHistory,cursor:string|null){
    const index=sourceIndex(history,cursor);
    const completed=history.requests.filter(request=>request.completed);
    return {completed:completed.length,pending:completed.filter(request=>history.entryIds.indexOf(request.throughId)>index).length};
  }
  function queue(projectId:string,sessionId:string,manual=false,range?:SourceRange){
    const state=job(sessionId);state.state="queued";
    state.timer=setTimeout(()=>{state.timer=undefined;state.state="idle";void schedule(projectId,sessionId,manual,range).catch(error=>fail(state,error));},250);
    state.timer.unref?.();
  }
  function fail(state:Job,error:unknown){state.state="failed";state.error=error instanceof DomainError?error.message:"记忆同步失败，可手动重试";}
  async function inspect(projectId:string,sessionId:string){
    const result=scope(projectId,sessionId),state=job(sessionId);
    let history:SessionMemoryHistory={entryIds:[],requests:[]},sourceError:string|null=null,completed=0,pending=0;
    try{history=await historyOf(result);const counts=progress(history,result.memory.lastReviewedEntryId);completed=counts.completed;pending=counts.pending;}
    catch(error){sourceError=error instanceof Error?error.message:"来源不可用";}
    if(pending>0&&!sourceError&&result.project.status==="active"&&result.session.state!=="ended"&&state.state==="idle")void schedule(projectId,sessionId,false).catch(error=>fail(state,error));
    const syncState=sourceError?"unavailable":state.state==="failed"?"failed":state.state==="generating"?"updating":pending>0||state.state==="queued"?"pending":"synced";
    return {sessionMemory:result.memory,writeETag:sessionMemoryETag(result.memory),generationState:state.state,syncState,memoryUpdatedAt:result.memory.updatedAt,error:sourceError??state.error,lastOutcome:state.lastOutcome,completedAnswerCount:completed,pendingAnswerCount:pending,hasUnreviewedMessages:pending>0,canWrite:result.project.status==="active",canSummarize:result.project.status==="active"&&!sourceError&&result.session.state!=="unavailable",availableRanges:history.requests.flatMap((request,index)=>request.completed?[{after:index===0?null:history.requests[index-1]?.throughId??null,through:request.throughId,label:`${request.createdAt} · ${request.user.slice(0,80)}`}]:[])};
  }
  async function schedule(projectId:string,sessionId:string,manual:boolean,range?:SourceRange){
    const state=job(sessionId);
    if(state.state==="generating"||state.state==="queued")return;
    if(!manual&&state.state==="failed")return;
    const result=writable(projectId,sessionId);
    if(result.session.state==="ended"&&!manual)return;
    if(result.session.state==="unavailable")throw new DomainError("MEMORY_SOURCE_UNAVAILABLE","请先恢复原生 Session 再同步",409,true);
    // Reserve before the first await: completion hooks, reads and manual clicks share one job.
    state.state="queued";state.error=null;state.checkAgain=false;
    try{
      // Main conversation may continue. Only manual Pi compaction requires a stable boundary.
      if(sessionLocks.has(sessionId)&&result.session.state==="idle"){queue(projectId,sessionId,manual,range);return;}
      const history=await historyOf(result);
      const after=range?range.after:result.memory.lastReviewedEntryId;
      const afterIndex=sourceIndex(history,after);
      let requests=history.requests.filter(request=>history.entryIds.indexOf(request.afterId)>afterIndex);
      if(range){const end=sourceIndex(history,range.through);if(end<=afterIndex)throw new DomainError("MEMORY_SOURCE_CHANGED","来源范围无效",409,true);requests=requests.filter(request=>history.entryIds.indexOf(request.throughId)<=end);}
      requests=requests.slice(0,requests.findLastIndex(request=>request.completed)+1);
      if(!requests.length){state.state="idle";if(manual)state.lastOutcome="no_new_messages";return;}
      const selected:SummaryRequest[]=[];let chars=0;
      for(const request of requests){const size=request.user.length+request.assistant.length;if(selected.length>=20||chars+size>24000)break;selected.push(request);chars+=size;}
      selected.splice(selected.findLastIndex(request=>request.completed)+1);
      if(!selected.length)throw new DomainError("SUMMARY_SOURCE_TOO_LARGE","来源过长，未跳过对话",422,true);
      const through=selected.at(-1)!.throughId,expected=sessionMemoryETag(result.memory);
      state.state="generating";
      void (async()=>{
        try{
          const output=await deps.runtime.summarize(result.memory.contextJson,selected,result.project.rootPath),context=validateContext(output.context);
          if(contextHash(context)===contextHash(emptyContext())&&selected.some(request=>request.user.trim()||request.assistant.trim()))throw new DomainError("SUMMARY_EMPTY_RESULT","模型未提炼出记忆内容，请重试；对话未被跳过",422,true);
          deps.validatePaths?.(context,result.project.rootPath);
          const latest=writable(projectId,sessionId),branch=await historyOf(latest);
          const endIndex=sourceIndex(branch,through),startIndex=sourceIndex(branch,after);
          if(endIndex<=startIndex)throw new DomainError("MEMORY_SOURCE_CHANGED","来源顺序已变更",409,true);
          // Explicit range resummarization cannot move the incremental cursor backwards.
          const currentIndex=latest.memory.lastReviewedEntryId?branch.entryIds.indexOf(latest.memory.lastReviewedEntryId):-1;
          const cursor=currentIndex>endIndex?latest.memory.lastReviewedEntryId:through;
          deps.memories.update(result.memory.id,expected,memory=>{
            state.lastOutcome=contextHash(context)===contextHash(memory.contextJson)?"no_change":"memory_updated";
            memory.contextJson=context;memory.lastReviewedEntryId=cursor;
          });
          state.state="idle";
          void schedule(projectId,sessionId,false).catch(error=>fail(state,error));
        }catch(error){
          if(error instanceof DomainError&&error.code==="MEMORY_CONFLICT"){
            state.state="idle";
            void schedule(projectId,sessionId,manual,range).catch(cause=>fail(state,cause));
          }else{
            const recheck=state.checkAgain;fail(state,error);
            if(recheck){state.state="idle";void schedule(projectId,sessionId,false).catch(cause=>fail(state,cause));}
          }
        }
      })();
    }catch(error){fail(state,error);throw error;}
  }
  return {
    inspect,
    async regenerate(projectId:string,sessionId:string,expected:string|null,body:Record<string,unknown>){
      const result=writable(projectId,sessionId);deps.memories.update(result.memory.id,expected,()=>{});
      const state=job(sessionId);if(state.state==="failed")state.state="idle";
      const range=typeof body.sourceThroughEntryId==="string"?{after:typeof body.sourceAfterEntryId==="string"?body.sourceAfterEntryId:null,through:body.sourceThroughEntryId}:undefined;
      await schedule(projectId,sessionId,true,range);return inspect(projectId,sessionId);
    },
    async change(projectId:string,sessionId:string,expected:string|null,action:string,body:Record<string,unknown>){
      if(action!=="context")throw new DomainError("INVALID_ACTION","记忆仅支持直接修改",400,true);
      const result=writable(projectId,sessionId);
      deps.memories.update(result.memory.id,expected,memory=>{memory.contextJson=validateContext(body.context);deps.validatePaths?.(memory.contextJson,result.project.rootPath);});
      return inspect(projectId,sessionId);
    },
    completed(sessionId:string){
      const session=deps.sessions.get(sessionId);if(!session)return;
      const state=job(sessionId);state.checkAgain=true;if(state.state==="failed")state.state="idle";
      void schedule(session.projectId,sessionId,false).catch(error=>fail(state,error));
    },
    templates(){return deps.memories.templates().map(memory=>({sessionMemory:memory,writeETag:sessionMemoryETag(memory)}));},
    saveTemplate(id:string|null,expected:string|null,body:Record<string,unknown>){
      const context=validateContext(body.context,true),title=typeof body.title==="string"?body.title.trim():"";
      if(!title||title.length>120)throw new DomainError("INVALID_INPUT","模板标题不能为空且最多 120 字符",422,true);
      if(id){const memory=deps.memories.get(id);if(!memory||memory.projectId!==null)throw new DomainError("NOT_FOUND","模板不存在",404,true);return deps.memories.update(id,expected,current=>{current.title=title;current.contextJson=context;});}
      const timestamp=new Date().toISOString();return deps.memories.insert({id:randomUUID(),projectId:null,sourceTemplateId:null,title,contextJson:context,draftJson:null,lastReviewedEntryId:null,createdAt:timestamp,updatedAt:timestamp});
    },
  };
}
