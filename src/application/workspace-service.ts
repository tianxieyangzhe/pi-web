import { DomainError } from "@/domain/errors";
import type { SessionToolsRuntimePort } from './ports/session-tools';
import { sessionThinkingLevels, type SessionThinkingLevel, type SessionModelView } from '@/domain/session-tools';
import { digest, exactKeys, parseWorkspaceConfiguration, workspaceETag, workspacePrompt, type WorkspaceSession, type WorkspaceSessionDTO } from "@/domain/workspace";
import type { WorkspaceDirectories, WorkspaceRepository } from "./ports/workspace";
import type { PiRuntimePort, SessionRuntimeInput } from "./ports/pi-runtime";
import type { PiContextPort } from "./ports/pi-context";
import type { JsonObject, Session, SessionState } from "@/domain/models";
import { SessionPresence } from "./session-presence";
import { SessionEvents } from "./session-events";
import { parseMessageReferences, type ReferenceContent, type ProjectReferenceTarget } from "@/domain/message-references";

type Runtime = PiRuntimePort & PiContextPort & Partial<Pick<SessionToolsRuntimePort,'models'|'switchModel'>> & {
  recordRequest?(input:SessionRuntimeInput,type:string,data:unknown):string;
  readRequestEntries(input: SessionRuntimeInput): Promise<Array<{type:string;data:unknown}>>;
  requestEntries(handle: object): Array<{type:string;data:unknown}>;
  requestEntry(handle: object, type: string, data: unknown): string;
};
type Evidence = {key:string;hash:string;outcome?:string;operation?:'switch-model'};
export function unresolvedRequests(entries: Array<{type:string;data:unknown}>) {
  const pending = new Map<string,Evidence>();
  for (const entry of entries) {
    const d = entry.data as Evidence;
    if (!d || typeof d.key !== 'string' || typeof d.hash !== 'string') continue;
    if (entry.type === 'workspace_request') pending.set(JSON.stringify([d.operation??'message',d.key]),d);
    else if (entry.type === 'workspace_request_result' || entry.type === 'workspace_request_acknowledged') pending.delete(JSON.stringify([d.operation??'message',d.key]));
  }
  return [...pending.values()];
}
export function createWorkspaceService(d: { repository: WorkspaceRepository; directories: WorkspaceDirectories; runtime: Runtime; sessionFiles?:ReturnType<typeof import('./session-file-service').createSessionFileService>; openHistory?:import('./ports/session-open-history').SessionOpenHistory; preview?:(value:WorkspaceSession)=>import('@/domain/session-preview').SessionPreview; listFiles?: (workspaceId:string,projectId:string,path:string)=>Promise<unknown>; readFile?: (workspaceId:string,projectId:string,path:string)=>Promise<import('@/domain/file-preview').FilePreview>; downloadFile?: (workspaceId:string,projectId:string,path:string)=>Promise<import('@/domain/file-preview').FileDownload>; resolveReference?: (workspaceId:string,reference:{projectId:string;path:string})=>ProjectReferenceTarget }) {
  const r=d.repository, rt=d.runtime;
  const running = new Map<string,{kind:'message'|'compact'|'model';done:Promise<void>}>();
  const states = new Map<string,SessionState>();
  const opened = new Map<string,Promise<object>>();
  const observed = new Map<string,{handle:object;unsubscribe:()=>void}>();
  const configuring = new Set<string>();
  const ending = new Set<string>();
  const compactState = new Map<string,'idle'|'running'|'failed'|'cancelled'>();
  function scope(workspaceId:string,id:string) { const value=r.session(workspaceId,id); if(!value)throw new DomainError('NOT_FOUND','工作区会话不存在',404,true); return value; }
  function state(value:WorkspaceSession):SessionState { return running.has(value.id)?running.get(value.id)!.kind==='message'?'running':'idle':states.get(value.id)??(value.nativeRef?'idle':'not_started'); }
  function input(value:WorkspaceSession):SessionRuntimeInput {
    const workspace=r.get(value.workspaceId);if(!workspace)throw new DomainError('NOT_FOUND','工作区不存在',404,true);
    const project=workspace.projects.find(p=>p.id===value.defaultProjectId);if(!project)throw new DomainError('START_PROJECT_UNAVAILABLE','默认项目不可用',409,true);
    // Runtime adapter only: no independent Project or Session is created by this projection.
    const session:Session={id:value.id,projectId:value.defaultProjectId,purpose:value.purpose,state:state(value),nativeRef:value.nativeRef,status:value.endedAt?'closed':'open',endedAt:value.endedAt,createdAt:value.createdAt,updatedAt:value.createdAt,lastActivityAt:null,agentId:null,agentSnapshot:null,mcpIds:[],mcpSnapshots:[],nativeMetadata:{}};
    if(value.nativeRef && value.nativeRef.cwd!==project.rootPath)throw new DomainError('NO_NATIVE_REF','默认目录与原生身份不一致',409,true);
    return {session,workingDirectory:project.rootPath,allowProjectRead:true,allowProjectWrite:true,nativeCodingTools:true,workspace:{id:workspace.id,defaultProjectId:project.id,projects:workspace.projects,prompt:workspacePrompt(workspace,project.id)}};
  }
  async function evidence(value:WorkspaceSession) {
    const handle=rt.getHandle(value.id);
    if(handle)return rt.requestEntries(handle);
    if(!value.nativeRef)return [];
    return rt.readRequestEntries(input(value));
  }
  async function assertKnown(value:WorkspaceSession) { if(unresolvedRequests(await evidence(value)).length)throw new DomainError('REQUEST_UNKNOWN','此前请求结果待核对，请先检查或明确承认未知结果',409,true); }
  function dto(value:WorkspaceSession):WorkspaceSessionDTO { const {nativeRef:_,endedAt:__,...base}=value;const status=presence.has(value.id)?'open' as const:'closed' as const;return {...base,lastOpenedAt:d.openHistory?.get({scope:'workspace',ownerId:value.workspaceId,sessionId:value.id})??null,...(d.preview?.(value)??{lastUserInput:null,lastActivityAt:value.createdAt,previewUnavailable:false}),status,allowedActions:running.has(value.id)?running.get(value.id)?.kind==='message'?['read','interrupt']:['read','inspect']:states.get(value.id)==='unavailable'?['read','inspect','recover']:['read','send','end','inspect']}; }
  async function release(id:string) { const observer=observed.get(id);observer?.unsubscribe();observed.delete(id);const handle=rt.getHandle(id);if(handle)await rt.close(handle); }
  const presence=new SessionPresence({busy:id=>running.has(id)||opened.has(id),release,abort:async id=>{if(running.has(id)){const handle=rt.getHandle(id);if(handle)await rt.interrupt(handle);await running.get(id)?.done;}}});
  const events=new SessionEvents(presence,undefined,id=>({running:running.get(id)?.kind==='message',compacting:running.get(id)?.kind==='compact'}));
  async function handleFor(value:WorkspaceSession) {
    if(ending.has(value.id))throw new DomainError('SESSION_BUSY','会话正在结束',409,true);
    if(configuring.has(value.workspaceId))throw new DomainError('WORKSPACE_BUSY','工作区配置正在更新',409,true);
    let opening=opened.get(value.id);
    if(!opening){
      opening=(async()=>{
        const setup=input(value);
        for(const project of setup.workspace!.projects)await d.directories.normalize(project.rootPath);
        let handle=rt.getHandle(value.id,setup);
        if(handle&&!running.has(value.id)&&!rt.isBusy?.(handle))await rt.refreshModel?.(handle);
        if(!handle){if(value.nativeRef)handle=await rt.restore(setup);else {if(!rt.initializeProject)throw new DomainError('RUNTIME_ERROR','原生初始化不可用',503,true);handle=await rt.initializeProject(setup,ref=>r.bindNative(value.workspaceId,value.id,ref));}}
        if(observed.get(value.id)?.handle!==handle){observed.get(value.id)?.unsubscribe();observed.set(value.id,{handle,unsubscribe:rt.subscribe?.(handle,event=>events.agent(value.id,event))??(()=>{})});}
        return handle;
      })().finally(()=>opened.delete(value.id));opened.set(value.id,opening);
    }
    return opening;
  }
  return {
    events,
    async sessionFilePreview(workspaceId:string,sessionId:string,path:string) {
      scope(workspaceId,sessionId);
      if(!d.sessionFiles)throw new DomainError('FILE_PREVIEW_UNAVAILABLE','会话文件服务尚未加载，请重启服务',503,true);
      return d.sessionFiles.preview(workspaceId,sessionId,path);
    },
    async sessionFileDownload(workspaceId:string,sessionId:string,path:string) {
      scope(workspaceId,sessionId);
      if(!d.sessionFiles)throw new DomainError('FILE_DOWNLOAD_UNAVAILABLE','会话文件服务尚未加载，请重启服务',503,true);
      return d.sessionFiles.download(workspaceId,sessionId,path);
    },
    list:()=>r.list(),
    get:(id:string)=>{const value=r.get(id);if(!value)throw new DomainError('NOT_FOUND','工作区不存在',404,true);return value;},
    directories:(path?:string)=>d.directories.list(path),
    async files(workspaceId:string,projectId:string,path:string) { const workspace=r.get(workspaceId);if(!workspace?.projects.some(p=>p.id===projectId))throw new DomainError('NOT_FOUND','工作区项目不存在',404,true);return d.listFiles?.(workspaceId,projectId,path); },
    async readFile(workspaceId:string,projectId:string,path:string) { const workspace=r.get(workspaceId);if(!workspace?.projects.some(p=>p.id===projectId))throw new DomainError('NOT_FOUND','工作区项目不存在',404,true);if(!d.readFile)throw new DomainError('FILE_PREVIEW_UNAVAILABLE','文件预览尚未加载，请重启服务',503,true);return d.readFile(workspaceId,projectId,path); },
    async downloadFile(workspaceId:string,projectId:string,path:string) { const workspace=r.get(workspaceId);if(!workspace?.projects.some(p=>p.id===projectId))throw new DomainError('NOT_FOUND','工作区项目不存在',404,true);if(!path)throw new DomainError('INVALID_PATH','缺少文件相对路径',400,true);if(!d.downloadFile)throw new DomainError('FILE_DOWNLOAD_UNAVAILABLE','文件下载尚未加载，请重启服务',503,true);return d.downloadFile(workspaceId,projectId,path); },
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
      {
        if(running.get(id)?.kind==='model')throw new DomainError('SESSION_BUSY','会话正在切换模型',409,true);
        try{await handleFor(value);states.set(id,'idle');}
        catch(error){if(!value.nativeRef||!(error instanceof DomainError)||!['MODEL_NOT_FOUND','MODEL_UNAVAILABLE'].includes(error.code))throw error;await rt.readTree!(input(value));states.set(id,'unavailable');}
      }
      const unknown=unresolvedRequests(await evidence(scope(workspaceId,id))).length>0;
      if(unknown&&!running.has(id))states.set(id,'unavailable');
      d.openHistory?.record({scope:'workspace',ownerId:workspaceId,sessionId:id});
      return {leaseId:presence.open(id),status:states.get(id)==='unavailable'?'unavailable':running.has(id)?'running':'ready',outcome:unknown&&!running.has(id)?'REQUEST_UNKNOWN':null};
    },
    async models(workspaceId:string,id:string,lease:string):Promise<SessionModelView>{
      const value=scope(workspaceId,id);if(!rt.models)throw new DomainError('RUNTIME_ERROR','模型列表能力不可用',503,true);
      const view=await rt.models(input(value));let reason:string|null=null;
      try{presence.assertLease(id,lease);if(!value.nativeRef)throw new DomainError('NO_NATIVE_REF','会话尚未初始化',409,true);if(running.has(id)||opened.has(id)||ending.has(id)||configuring.has(workspaceId))throw new DomainError('SESSION_BUSY','会话正在变化',409,true);await assertKnown(value);}catch(error){reason=error instanceof DomainError?error.code:'REQUEST_UNKNOWN';}
      return {...view,canSwitch:reason===null,unavailableReason:reason};
    },
    async switchModel(workspaceId:string,id:string,body:Record<string,unknown>,key:string,lease:string):Promise<SessionModelView>{
      exactKeys(body,['provider','modelId','thinkingLevel']);
      if(body.thinkingLevel!==undefined&&!sessionThinkingLevels.includes(body.thinkingLevel as SessionThinkingLevel))throw new DomainError('INVALID_INPUT','思考等级无效',400,true);const value=scope(workspaceId,id);presence.assertLease(id,lease);
      if(!/^[\x21-\x7e]{1,128}$/.test(key))throw new DomainError('INVALID_IDEMPOTENCY_KEY','缺少或无效幂等键',400,true);
      for(const field of ['provider','modelId'])if(typeof body[field]!=='string'||!(body[field] as string).trim()||Array.from(body[field] as string).length>1024)throw new DomainError('INVALID_INPUT','模型标识无效',400,true);
      if(!value.nativeRef)throw new DomainError('NO_NATIVE_REF','会话尚未初始化',409,true);
      if(running.has(id)||opened.has(id)||ending.has(id)||configuring.has(workspaceId))throw new DomainError('SESSION_BUSY','会话正在变化',409,true);
      if(!rt.models||!rt.switchModel||!rt.recordRequest)throw new DomainError('RUNTIME_ERROR','模型切换能力不可用',503,true);
      const identity={provider:body.provider as string,modelId:body.modelId as string,...(body.thinkingLevel!==undefined?{thinkingLevel:body.thinkingLevel as SessionThinkingLevel}:{})},request:Evidence={key,hash:digest({operation:'switch-model',...identity}),operation:'switch-model'};
      let finish!:()=>void;const done=new Promise<void>(resolve=>{finish=resolve;});running.set(id,{kind:'model',done});
      try{
        const setup=input(scope(workspaceId,id)),entries=await evidence(value),existing=entries.find(e=>e.type==='workspace_request'&&(e.data as Evidence).operation==='switch-model'&&(e.data as Evidence).key===key)?.data as Evidence|undefined;
        if(existing){if(existing.hash!==request.hash)throw new DomainError('IDEMPOTENCY_CONFLICT','请求键已用于其他型号',409,true);const result=entries.find(e=>e.type==='workspace_request_result'&&(e.data as Evidence).operation==='switch-model'&&(e.data as Evidence).key===key)?.data as Evidence|undefined;if(!result||result.outcome!=='settled')throw new DomainError('REQUEST_UNKNOWN','旧模型切换不能重放，请核对结果后以新键表达选择',409,true);return rt.models(setup);}
        await assertKnown(value);
        rt.recordRequest(setup,'workspace_request',request);
        try{await rt.switchModel(setup,identity);rt.recordRequest(setup,'workspace_request_result',{...request,outcome:'settled'});states.set(id,'idle');}
        catch(error){if(error instanceof DomainError&&(error as DomainError&{noSideEffects?:boolean}).noSideEffects){rt.recordRequest(setup,'workspace_request_result',{...request,outcome:'failed'});throw error;}states.set(id,'unavailable');throw new DomainError('REQUEST_UNKNOWN','模型切换结果待核对，请检查原生历史和请求记录，不能自动重试',409,true);}
        return rt.models(setup);
      }finally{running.delete(id);finish();presence.settled(id);}
    },
    assertLease:(id:string,lease:string)=>presence.assertLease(id,lease),
    close:(id:string,lease:string)=>presence.release(id,lease),
    async messages(workspaceId:string,id:string){const value=scope(workspaceId,id);if(!value.nativeRef)return {entries:[],activeLeafId:null};return rt.readTree!(input(value));},
    async accept(workspaceId:string,id:string,body:Record<string,unknown>,key:string,lease:string) {
      exactKeys(body,['content','references','webSearch','toolSearch']);for(const field of ['webSearch','toolSearch'])if(body[field]!==undefined&&typeof body[field]!=='boolean')throw new DomainError('INVALID_INPUT',`${field}必须为布尔值`,400,true);const value=scope(workspaceId,id);presence.assertLease(id,lease);
      if(typeof body.content!=='string'||!body.content.trim()||Buffer.byteLength(body.content)>32768)throw new DomainError('INVALID_INPUT','消息不能为空且不得超过 32KiB',400,true);
      if(!key)throw new DomainError('PRECONDITION_REQUIRED','缺少 Idempotency-Key',428,true);
      if(configuring.has(workspaceId)||running.has(id)||ending.has(id))throw new DomainError('SESSION_BUSY','会话正在运行或工作区正在更新',409,true);
      // Reserve before the first await; a second request cannot race preparation.
      let finish!:()=>void;const done=new Promise<void>(resolve=>{finish=resolve;});running.set(id,{kind:'message',done});
      try {
        const {webSearch,toolSearch,...originalBody}=body;const hash=digest({...originalBody,...(webSearch===true?{webSearch:true}:{}),...(toolSearch===true?{toolSearch:true}:{})}),entries=await evidence(value);
        const existing=entries.find(entry=>entry.type==='workspace_request'&&!(entry.data as Evidence).operation&&(entry.data as Evidence).key===key)?.data as Evidence|undefined;
        if(existing){if(existing.hash!==hash)throw new DomainError('IDEMPOTENCY_CONFLICT','请求键已用于其他消息',409,true);return {accepted:true,sessionId:id};}
        await assertKnown(value);
        const handle=await handleFor(value),workspace=r.get(workspaceId)!;
        const references=parseMessageReferences(body.references,new Set(workspace.projects.map(p=>p.id)),d.resolveReference?reference=>d.resolveReference!(workspaceId,reference):undefined);
        if(body.webSearch===true){if(!rt.validateWebSearch)throw new DomainError('WEB_SEARCH_UNSUPPORTED','当前运行时不支持服务端搜索，请关闭联网搜索',422,true);rt.validateWebSearch(handle);}
        if(body.toolSearch===true){if(!rt.validateToolSearch)throw new DomainError('TOOL_SEARCH_UNAVAILABLE','当前运行时未装配工具搜索，请关闭工具搜索或重启服务',422,true);rt.validateToolSearch();}
        rt.requestEntry(handle,'workspace_request',{key,hash});
        states.set(id,'running');events.agent(id,{type:'session_state',state:'starting'});
        const work=rt.send(handle,body.content,event=>{if(event.type!=='pi_event'&&event.type!=='entry_link')events.agent(id,event);},undefined,references,true,body.webSearch===true,body.toolSearch===true)
          .then(()=>{rt.requestEntry(handle,'workspace_request_result',{key,hash,outcome:'settled'});states.set(id,'idle');events.agent(id,{type:'complete'});})
          .catch(error=>{const known=error instanceof DomainError&&error.code!=='REQUEST_UNKNOWN';try{if(known)rt.requestEntry(handle,'workspace_request_result',{key,hash,outcome:(error as DomainError).code==='REQUEST_ABORTED'?'aborted':'failed'});}catch{/* Keep pending evidence for recovery. */}states.set(id,known?'idle':'unavailable');events.agent(id,{type:'error',code:known?(error as DomainError).code:'REQUEST_UNKNOWN',message:known?(error as DomainError).message:'请求结果待核对，不能自动重试',recoverable:true});})
          .finally(()=>{running.delete(id);finish();presence.settled(id);});
        running.set(id,{kind:'message',done:work});
        return {accepted:true,sessionId:id};
      } finally {if(running.get(id)?.done===done){running.delete(id);finish();presence.settled(id);}}
    },
    async interrupt(workspaceId:string,id:string){scope(workspaceId,id);if(running.has(id)&&running.get(id)?.kind!=='message')throw new DomainError('SESSION_BUSY','当前不是可中止的主请求',409,true);const handle=rt.getHandle(id);if(handle&&running.has(id)){await rt.interrupt(handle);await running.get(id)?.done;}return dto(scope(workspaceId,id));},
    async restore(workspaceId:string,id:string){const value=scope(workspaceId,id);if(running.has(id))throw new DomainError('SESSION_BUSY','会话正在运行',409,true);await assertKnown(value);await handleFor(value);states.set(id,'idle');return dto(value);},
    async end(workspaceId:string,id:string) {
      const value=scope(workspaceId,id);
      if(running.has(id)||opened.has(id)||ending.has(id)||configuring.has(workspaceId))throw new DomainError('SESSION_BUSY','请先停止运行或压缩',409,true);
      ending.add(id);
      try {await assertKnown(value);events.closeSession(id);presence.forget(id);await release(id);return dto(value);}
      finally {ending.delete(id);}
    },
    async deleteSession(workspaceId:string,id:string) {
      const value=scope(workspaceId,id);
      if(running.has(id)||opened.has(id)||ending.has(id)||configuring.has(workspaceId))throw new DomainError('SESSION_BUSY','请等待会话操作结束后删除',409,true);
      ending.add(id);
      try {
        await assertKnown(value);
        await release(id);
        r.deleteSession(workspaceId,id);
        events.closeSession(id);presence.forget(id);states.delete(id);compactState.delete(id);
        return {deleted:true,sessionId:id};
      }finally{ending.delete(id);}
    },
    async inspect(workspaceId:string,id:string){const value=scope(workspaceId,id),inspection=await rt.inspect(input(value));inspection.compactionState=compactState.get(id)??'idle';inspection.canCancelCompaction=running.get(id)?.kind==='compact';if(running.has(id)){inspection.canCompact=false;inspection.unavailableReason='会话正在运行';}return inspection;},
    async compact(workspaceId:string,id:string){const value=scope(workspaceId,id);if(running.has(id)||ending.has(id)||configuring.has(workspaceId))throw new DomainError('SESSION_BUSY','当前不能压缩',409,true);await assertKnown(value);if(running.has(id)||ending.has(id)||configuring.has(workspaceId))throw new DomainError('SESSION_BUSY','会话或工作区正在变化',409,true);const handle=rt.getHandle(id);if(!handle)throw new DomainError('RUNTIME_NOT_OPEN','会话连接不可用，请重新连接',409,true);compactState.set(id,'running');const done=rt.compact(handle).then(()=>{if(compactState.get(id)!=='cancelled')compactState.set(id,'idle');}).catch(()=>{if(compactState.get(id)!=='cancelled')compactState.set(id,'failed');}).finally(()=>{running.delete(id);presence.settled(id);events.agent(id,{type:"context_changed"});});running.set(id,{kind:'compact',done});return {accepted:true};},
    cancelCompact(workspaceId:string,id:string){scope(workspaceId,id);const handle=rt.getHandle(id);if(!handle||running.get(id)?.kind!=='compact')throw new DomainError('COMPACTION_NOT_RUNNING','没有运行中的压缩',409,true);rt.cancelCompaction(handle);compactState.set(id,'cancelled');return {accepted:true};},
    async recover(workspaceId:string,id:string,action:string){const value=scope(workspaceId,id);if(!['inspect','acknowledge-unknown'].includes(action))throw new DomainError('INVALID_INPUT','恢复动作无效',400,true);if(running.has(id)||ending.has(id))throw new DomainError('SESSION_BUSY','会话仍在运行或删除',409,true);const pending=unresolvedRequests(await evidence(value));if(ending.has(id))throw new DomainError('SESSION_BUSY','会话正在删除',409,true);scope(workspaceId,id);if(action==='acknowledge-unknown'&&pending.length){if(rt.recordRequest&&value.nativeRef){for(const request of pending)rt.recordRequest(input(value),'workspace_request_acknowledged',request);}else{const handle=await handleFor(value);for(const request of pending)rt.requestEntry(handle,'workspace_request_acknowledged',request);}states.set(id,rt.getHandle(id)?'idle':'unavailable');}return {pending:action==='inspect'?pending:[],sessionId:id};},
  };
}
