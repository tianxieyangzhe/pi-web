import { DomainError } from "@/domain/errors";
import { digest, exactKeys, parseWorkspaceConfiguration, workspaceETag, workspacePrompt, type WorkspaceSession, type WorkspaceSessionDTO } from "@/domain/workspace";
import type { WorkspaceDirectories, WorkspaceRepository } from "./ports/workspace";
import type { PiRuntimePort, SessionRuntimeInput } from "./ports/pi-runtime";
import type { PiContextPort } from "./ports/pi-context";
import type { JsonObject, Session, SessionState } from "@/domain/models";
import type { SessionMemoryRuntimePort } from "./ports/session-memory-runtime";
import { SessionPresence } from "./session-presence";
import { SessionEvents } from "./session-events";
import { validateContext } from "@/domain/session-memory";
import { parseMessageReferences, type ReferenceContent } from "@/domain/message-references";

type Runtime = PiRuntimePort & PiContextPort & SessionMemoryRuntimePort & {
  readRequestEntries(input: SessionRuntimeInput): Promise<Array<{type:string;data:unknown}>>;
  requestEntries(handle: object): Array<{type:string;data:unknown}>;
  requestEntry(handle: object, type: string, data: unknown): string;
};
type Evidence = {key:string;hash:string;outcome?:string};
export function unresolvedRequests(entries: Array<{type:string;data:unknown}>) {
  const pending = new Map<string,Evidence>();
  for (const entry of entries) {
    const d = entry.data as Evidence;
    if (!d || typeof d.key !== 'string' || typeof d.hash !== 'string') continue;
    if (entry.type === 'workspace_request') pending.set(d.key,d);
    else if (entry.type === 'workspace_request_result' || entry.type === 'workspace_request_acknowledged') pending.delete(d.key);
  }
  return [...pending.values()];
}
export function createWorkspaceService(d: { repository: WorkspaceRepository; directories: WorkspaceDirectories; runtime: Runtime; listFiles?: (workspaceId:string,projectId:string,path:string)=>Promise<unknown>; readFile?: (workspaceId:string,projectId:string,path:string)=>Promise<{path:string;content:string;size:number}>; readReference?: (workspaceId:string,reference:{projectId:string;path:string})=>{name:string;data:string} }) {
  const r=d.repository, rt=d.runtime;
  const running = new Map<string,{kind:'message'|'compact';done:Promise<void>}>();
  const states = new Map<string,SessionState>();
  const opened = new Map<string,Promise<object>>();
  const observed = new Map<string,{handle:object;unsubscribe:()=>void}>();
  const configuring = new Set<string>();
  const ending = new Set<string>();
  const summaries = new Set<string>();
  const summaryErrors = new Map<string,string>();
  const compactState = new Map<string,'idle'|'running'|'failed'|'cancelled'>();
  function scope(workspaceId:string,id:string) { const value=r.session(workspaceId,id); if(!value)throw new DomainError('NOT_FOUND','工作区会话不存在',404,true); return value; }
  function state(value:WorkspaceSession):SessionState { return value.endedAt?'ended':running.has(value.id)?running.get(value.id)!.kind==='message'?'running':'idle':states.get(value.id)??(value.nativeRef?'idle':'not_started'); }
  function input(value:WorkspaceSession):SessionRuntimeInput {
    const workspace=r.get(value.workspaceId);if(!workspace)throw new DomainError('NOT_FOUND','工作区不存在',404,true);
    const project=workspace.projects.find(p=>p.id===value.defaultProjectId);if(!project)throw new DomainError('START_PROJECT_UNAVAILABLE','默认项目不可用',409,true);
    // Runtime adapter only: no independent Project or Session is created by this projection.
    const session:Session={id:value.id,sessionMemoryId:value.sessionMemoryId,projectId:value.defaultProjectId,purpose:value.purpose,state:state(value),nativeRef:value.nativeRef,status:value.endedAt?'closed':'open',endedAt:value.endedAt,createdAt:value.createdAt,updatedAt:value.createdAt,lastActivityAt:null,agentId:null,agentSnapshot:null,mcpIds:[],mcpSnapshots:[],nativeMetadata:{},botConversationId:null,participantName:null,assignment:null,collaborationState:null,botJoinedAt:null};
    if(value.nativeRef && value.nativeRef.cwd!==project.rootPath)throw new DomainError('NO_NATIVE_REF','默认目录与原生身份不一致',409,true);
    return {session,workingDirectory:project.rootPath,allowProjectRead:true,allowProjectWrite:true,independentProjectTools:true,workspace:{id:workspace.id,defaultProjectId:project.id,projects:workspace.projects,prompt:workspacePrompt(workspace,project.id)}};
  }
  async function evidence(value:WorkspaceSession) {
    const handle=rt.getHandle(value.id);
    if(handle)return rt.requestEntries(handle);
    if(!value.nativeRef)return [];
    return rt.readRequestEntries(input(value));
  }
  async function assertKnown(value:WorkspaceSession) { if(unresolvedRequests(await evidence(value)).length)throw new DomainError('REQUEST_UNKNOWN','此前请求结果待核对，请先检查或明确承认未知结果',409,true); }
  function dto(value:WorkspaceSession):WorkspaceSessionDTO { const {nativeRef:_,sessionMemoryId:__,...base}=value;return {...base,state:state(value),memorySummary:r.memory(value.workspaceId,value.sessionMemoryId).contextJson.summary,allowedActions:value.endedAt?['read']:running.has(value.id)?['read','interrupt']:states.get(value.id)==='unavailable'?['read','inspect','recover']:['read','send','end','inspect']}; }
  async function release(id:string) { const observer=observed.get(id);observer?.unsubscribe();observed.delete(id);const handle=rt.getHandle(id);if(handle)await rt.close(handle); }
  const presence=new SessionPresence({busy:id=>running.has(id)||opened.has(id),release,abort:async id=>{if(running.has(id)){const handle=rt.getHandle(id);if(handle)await rt.interrupt(handle);await running.get(id)?.done;}}});
  const events=new SessionEvents(presence);
  async function handleFor(value:WorkspaceSession) {
    if(ending.has(value.id))throw new DomainError('SESSION_BUSY','会话正在结束',409,true);
    if(configuring.has(value.workspaceId))throw new DomainError('WORKSPACE_BUSY','工作区配置正在更新',409,true);
    let opening=opened.get(value.id);
    if(!opening){
      opening=(async()=>{
        const setup=input(value);
        for(const project of setup.workspace!.projects)await d.directories.normalize(project.rootPath);
        let handle=rt.getHandle(value.id,setup);
        if(!handle){if(value.nativeRef)handle=await rt.restore(setup);else {if(!rt.initializeProject)throw new DomainError('RUNTIME_ERROR','原生初始化不可用',503,true);handle=await rt.initializeProject(setup,ref=>r.bindNative(value.workspaceId,value.id,ref));}}
        if(observed.get(value.id)?.handle!==handle){observed.get(value.id)?.unsubscribe();observed.set(value.id,{handle,unsubscribe:rt.subscribe?.(handle,event=>events.agent(value.id,event))??(()=>{})});}
        return handle;
      })().finally(()=>opened.delete(value.id));opened.set(value.id,opening);
    }
    return opening;
  }
  async function summarize(value:WorkspaceSession) {
    if(summaries.has(value.id)||!value.nativeRef)return;summaries.add(value.id);
    try {
      const memory=r.memory(value.workspaceId,value.sessionMemoryId),history=await rt.history(input(value));
      const cursor=memory.lastReviewedEntryId?history.requests.findIndex(req=>req.throughId===memory.lastReviewedEntryId):-1;
      const remaining=history.requests.slice(cursor+1),lastComplete=remaining.findLastIndex(req=>req.completed);
      const requests=remaining.slice(0,lastComplete+1);if(!requests.length)return;
      const summary=await rt.summarize(memory.contextJson,requests,input(value).workingDirectory);
      const context=validateContext(summary.context);context.outputs=context.outputs.map(output=>({...output,path:null}));
      r.updateMemory(value.workspaceId,memory.id,workspaceETag(memory),context,requests.at(-1)!.throughId);summaryErrors.delete(value.id);
    } catch {summaryErrors.set(value.id,'记忆总结失败或基线已变化；当前已保存内容保留。');}
    finally {summaries.delete(value.id);}
  }
  return {
    events,
    list:()=>r.list(),
    get:(id:string)=>{const value=r.get(id);if(!value)throw new DomainError('NOT_FOUND','工作区不存在',404,true);return value;},
    directories:(path?:string)=>d.directories.list(path),
    async files(workspaceId:string,projectId:string,path:string) { const workspace=r.get(workspaceId);if(!workspace?.projects.some(p=>p.id===projectId))throw new DomainError('NOT_FOUND','工作区项目不存在',404,true);return d.listFiles?.(workspaceId,projectId,path); },
    async readFile(workspaceId:string,projectId:string,path:string) { const workspace=r.get(workspaceId);if(!workspace?.projects.some(p=>p.id===projectId))throw new DomainError('NOT_FOUND','工作区项目不存在',404,true);if(!d.readFile)throw new DomainError('FILE_PREVIEW_UNAVAILABLE','文件预览尚未加载，请重启服务',503,true);return d.readFile(workspaceId,projectId,path); },
    async save(id:string|null,body:Record<string,unknown>,credential:string) {
      const configuration=parseWorkspaceConfiguration(body);
      if(!credential)throw new DomainError('PRECONDITION_REQUIRED',id?'缺少 If-Match':'缺少 Idempotency-Key',428,true);
      if(id&&configuring.has(id))throw new DomainError('WORKSPACE_BUSY','工作区配置正在更新',409,true);
      if(id)configuring.add(id);
      try {
        if(id)for(const value of r.sessions(id)){if(running.has(value.id)||opened.has(value.id)||ending.has(value.id))throw new DomainError('WORKSPACE_BUSY','工作区有运行或压缩中的会话',409,true);await assertKnown(value);}
        for(const project of configuration.projects)project.rootPath=await d.directories.normalize(project.rootPath);
        return r.save(id,configuration,credential);
      }finally{if(id)configuring.delete(id);}
    },
    sessions:(workspaceId:string)=>r.sessions(workspaceId).map(dto),
    session:(workspaceId:string,id:string)=>dto(scope(workspaceId,id)),
    createSession(workspaceId:string,body:Record<string,unknown>,key:string) {
      exactKeys(body,['defaultProjectId','purpose']);
      if(!key)throw new DomainError('PRECONDITION_REQUIRED','缺少 Idempotency-Key',428,true);
      if(configuring.has(workspaceId))throw new DomainError('WORKSPACE_BUSY','工作区配置正在更新',409,true);
      if(body.defaultProjectId!==undefined&&typeof body.defaultProjectId!=='string'||body.purpose!==undefined&&(typeof body.purpose!=='string'||body.purpose.length>500))throw new DomainError('INVALID_INPUT','会话创建参数无效',400,true);
      return dto(r.createSession(workspaceId,body.defaultProjectId as string|undefined,String(body.purpose??'工作区会话'),key));
    },
    async open(workspaceId:string,id:string) {
      if(ending.has(id))throw new DomainError('SESSION_BUSY','会话正在结束或删除',409,true);
      const value=scope(workspaceId,id);if(configuring.has(workspaceId))throw new DomainError('WORKSPACE_BUSY','工作区配置正在更新',409,true);
      if(value.endedAt){if(!value.nativeRef)throw new DomainError('NO_NATIVE_REF','已结束会话无原生历史',409,true);await rt.readTree!(input(value));}
      else await handleFor(value);
      const unknown=unresolvedRequests(await evidence(scope(workspaceId,id))).length>0;
      if(unknown&&!running.has(id))states.set(id,'unavailable');
      return {leaseId:presence.open(id),status:running.has(id)?'running':'ready',outcome:unknown&&!running.has(id)?'REQUEST_UNKNOWN':null};
    },
    assertLease:(id:string,lease:string)=>presence.assertLease(id,lease),
    close:(id:string,lease:string)=>presence.release(id,lease),
    async messages(workspaceId:string,id:string){const value=scope(workspaceId,id);if(!value.nativeRef)return {entries:[],activeLeafId:null};return rt.readTree!(input(value));},
    async accept(workspaceId:string,id:string,body:Record<string,unknown>,key:string,lease:string) {
      exactKeys(body,['content','references']);const value=scope(workspaceId,id);presence.assertLease(id,lease);
      if(typeof body.content!=='string'||!body.content.trim()||Buffer.byteLength(body.content)>32768)throw new DomainError('INVALID_INPUT','消息不能为空且不得超过 32KiB',400,true);
      if(!key)throw new DomainError('PRECONDITION_REQUIRED','缺少 Idempotency-Key',428,true);
      if(value.endedAt)throw new DomainError('SESSION_ENDED','会话已结束',409,true);
      if(configuring.has(workspaceId)||running.has(id)||ending.has(id))throw new DomainError('SESSION_BUSY','会话正在运行或工作区正在更新',409,true);
      // Reserve before the first await; a second request cannot race preparation.
      let finish!:()=>void;const done=new Promise<void>(resolve=>{finish=resolve;});running.set(id,{kind:'message',done});
      try {
        const hash=digest(body),entries=await evidence(value);
        const existing=entries.find(entry=>entry.type==='workspace_request'&&(entry.data as Evidence).key===key)?.data as Evidence|undefined;
        if(existing){if(existing.hash!==hash)throw new DomainError('IDEMPOTENCY_CONFLICT','请求键已用于其他消息',409,true);return {accepted:true,sessionId:id};}
        await assertKnown(value);
        const handle=await handleFor(value),workspace=r.get(workspaceId)!;
        const references=parseMessageReferences(body.references,new Set(workspace.projects.map(p=>p.id)),d.readReference?reference=>d.readReference!(workspaceId,reference):undefined);
        rt.requestEntry(handle,'workspace_request',{key,hash});
        states.set(id,'running');events.agent(id,{type:'session_state',state:'starting'});
        const work=rt.send(handle,body.content,event=>{if(event.type!=='pi_event'&&event.type!=='entry_link')events.agent(id,event);},undefined,references,true)
          .then(()=>{rt.requestEntry(handle,'workspace_request_result',{key,hash,outcome:'settled'});states.set(id,'idle');events.agent(id,{type:'complete'});void summarize(scope(workspaceId,id));})
          .catch(error=>{const known=error instanceof DomainError&&error.code!=='REQUEST_UNKNOWN';try{if(known)rt.requestEntry(handle,'workspace_request_result',{key,hash,outcome:(error as DomainError).code==='REQUEST_ABORTED'?'aborted':'failed'});}catch{/* Keep pending evidence for recovery. */}states.set(id,known?'idle':'unavailable');events.agent(id,{type:'error',code:known?(error as DomainError).code:'REQUEST_UNKNOWN',message:known?(error as DomainError).message:'请求结果待核对，不能自动重试',recoverable:true});})
          .finally(()=>{running.delete(id);finish();presence.settled(id);});
        running.set(id,{kind:'message',done:work});
        return {accepted:true,sessionId:id};
      } finally {if(running.get(id)?.done===done){running.delete(id);finish();presence.settled(id);}}
    },
    async interrupt(workspaceId:string,id:string){scope(workspaceId,id);if(running.get(id)?.kind==='compact')throw new DomainError('SESSION_BUSY','请使用取消压缩',409,true);const handle=rt.getHandle(id);if(handle&&running.has(id)){await rt.interrupt(handle);await running.get(id)?.done;}return dto(scope(workspaceId,id));},
    async restore(workspaceId:string,id:string){const value=scope(workspaceId,id);if(value.endedAt)throw new DomainError('SESSION_ENDED','会话已结束',409,true);if(running.has(id))throw new DomainError('SESSION_BUSY','会话正在运行',409,true);await assertKnown(value);await handleFor(value);states.set(id,'idle');return dto(value);},
    async end(workspaceId:string,id:string) {
      const value=scope(workspaceId,id);
      if(running.has(id)||opened.has(id)||ending.has(id)||configuring.has(workspaceId))throw new DomainError('SESSION_BUSY','请先停止运行或压缩',409,true);
      ending.add(id);
      try {await assertKnown(value);await release(id);return dto(r.end(workspaceId,id));}
      finally {ending.delete(id);}
    },
    async deleteSession(workspaceId:string,id:string) {
      const value=scope(workspaceId,id);
      if(running.has(id)||opened.has(id)||ending.has(id)||summaries.has(id)||configuring.has(workspaceId))throw new DomainError('SESSION_BUSY','请等待会话和记忆处理结束后删除',409,true);
      ending.add(id);
      try {
        await assertKnown(value);
        await release(id);
        r.deleteSession(workspaceId,id);
        presence.forget(id);states.delete(id);compactState.delete(id);summaryErrors.delete(id);
        return {deleted:true,sessionId:id};
      }finally{ending.delete(id);}
    },
    async inspect(workspaceId:string,id:string){const value=scope(workspaceId,id),inspection=await rt.inspect(input(value));inspection.compactionState=compactState.get(id)??'idle';inspection.canCancelCompaction=running.get(id)?.kind==='compact';if(running.has(id)||value.endedAt){inspection.canCompact=false;inspection.unavailableReason='会话已结束或正在运行';}return inspection;},
    async compact(workspaceId:string,id:string){const value=scope(workspaceId,id);if(value.endedAt||running.has(id)||ending.has(id)||configuring.has(workspaceId))throw new DomainError('SESSION_BUSY','当前不能压缩',409,true);await assertKnown(value);if(running.has(id)||ending.has(id)||configuring.has(workspaceId))throw new DomainError('SESSION_BUSY','会话或工作区正在变化',409,true);const handle=rt.getHandle(id);if(!handle)throw new DomainError('RUNTIME_NOT_OPEN','请先打开会话',409,true);compactState.set(id,'running');const done=rt.compact(handle).then(()=>{if(compactState.get(id)!=='cancelled')compactState.set(id,'idle');}).catch(()=>{if(compactState.get(id)!=='cancelled')compactState.set(id,'failed');}).finally(()=>{running.delete(id);presence.settled(id);});running.set(id,{kind:'compact',done});return {accepted:true};},
    cancelCompact(workspaceId:string,id:string){scope(workspaceId,id);const handle=rt.getHandle(id);if(!handle||running.get(id)?.kind!=='compact')throw new DomainError('COMPACTION_NOT_RUNNING','没有运行中的压缩',409,true);rt.cancelCompaction(handle);compactState.set(id,'cancelled');return {accepted:true};},
    memory(workspaceId:string,id:string){const value=scope(workspaceId,id),memory=r.memory(workspaceId,value.sessionMemoryId);return {sessionMemory:{...memory,projectId:null,sourceTemplateId:null,draftJson:null},writeETag:workspaceETag(memory),syncState:summaries.has(id)?'updating':summaryErrors.has(id)?'failed':'synced',pendingAnswerCount:null,completedAnswerCount:null,hasUnreviewedMessages:null,sourceRange:null,canWrite:true,canSummarize:!running.has(id)&&!!value.nativeRef&&!summaries.has(id),generationState:summaries.has(id)?'generating':summaryErrors.has(id)?'failed':'idle',error:summaryErrors.get(id)??null,lastOutcome:summaryErrors.has(id)?'failed':'unknown',availableRanges:[],memoryUpdatedAt:memory.updatedAt};},
    changeMemory(workspaceId:string,id:string,body:Record<string,unknown>,etag:string){exactKeys(body,['contextJson']);const value=scope(workspaceId,id);if(!etag)throw new DomainError('PRECONDITION_REQUIRED','缺少 If-Match',428,true);r.updateMemory(workspaceId,value.sessionMemoryId,etag,validateContext(body.contextJson));return this.memory(workspaceId,id);},
    async summarizeMemory(workspaceId:string,id:string) {const value=scope(workspaceId,id);if(running.has(id)||opened.has(id)||ending.has(id)||configuring.has(workspaceId))throw new DomainError('SESSION_BUSY','请等待会话稳定后总结',409,true);await summarize(value);return this.memory(workspaceId,id);},
    async recover(workspaceId:string,id:string,action:string){const value=scope(workspaceId,id);if(!['inspect','acknowledge-unknown'].includes(action))throw new DomainError('INVALID_INPUT','恢复动作无效',400,true);if(running.has(id)||ending.has(id))throw new DomainError('SESSION_BUSY','会话仍在运行或删除',409,true);const pending=unresolvedRequests(await evidence(value));if(ending.has(id))throw new DomainError('SESSION_BUSY','会话正在删除',409,true);scope(workspaceId,id);if(action==='acknowledge-unknown'&&pending.length){const handle=await handleFor(value);for(const request of pending)rt.requestEntry(handle,'workspace_request_acknowledged',request);states.set(id,'idle');}return {pending:action==='inspect'?pending:[],sessionId:id};},
  };
}
