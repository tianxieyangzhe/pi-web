import {createHash,randomUUID} from 'node:crypto';
import {DomainError} from '@/domain/errors';
import type {ProjectRuleIdentity,ProjectRulesStore} from './ports/project-rules';
import {activeGeneration,type ProjectRuleGenerationsStore,type ProjectRuleGeneration,type StoredProjectRuleGeneration,type ProjectRulesStatus} from './ports/project-rule-generations';
import {createAgentPreparationService,type AgentSourceProject,type AgentPreparationProgress} from './agent-service';

export function createProjectRulesService(d:{store:ProjectRulesStore;generations:ProjectRuleGenerationsStore;resolve:(identity:ProjectRuleIdentity)=>AgentSourceProject;prepare:ReturnType<typeof createAgentPreparationService>}){
 const active=new Map<string,{task:StoredProjectRuleGeneration;controller:AbortController}>();
 const identityKey=(id:ProjectRuleIdentity)=>JSON.stringify(id.scope==='project'?['project',id.projectId]:['workspace',id.workspaceId,id.projectId]);
 const publicTask=({requestKey,baseETag,inputRevision,resultSha256,...task}:StoredProjectRuleGeneration):ProjectRuleGeneration=>({...task,mode:task.mode??'generate'});
 const save=(id:ProjectRuleIdentity,task:StoredProjectRuleGeneration)=>{task.updatedAt=new Date().toISOString();d.generations.save(id,task);};
 function reconcile(id:ProjectRuleIdentity){
  const tasks=d.generations.list(id),running=active.get(identityKey(id));
  for(const task of tasks){
   if(!activeGeneration(task.status)||running?.task.id===task.id)continue;
   const rules=d.store.read(id),published=task.status==='publishing'&&task.resultSha256===rules.contentSha256&&rules.revision>task.inputRevision;
   task.status=published?'succeeded':'interrupted';task.completedAt=new Date().toISOString();task.resultRevision=published?rules.revision:null;
   task.error=published?null:{code:'GENERATION_INTERRUPTED',message:'生成任务已中断，请重新生成'};save(id,task);
  }
  return tasks;
 }
 function view(id:ProjectRuleIdentity,task?:StoredProjectRuleGeneration):ProjectRulesStatus {
  return {...d.store.read(id),generation:task?publicTask(task):null};
 }
 function parameters(body:Record<string,unknown>){
  if(Object.keys(body).some(k=>!['mode','requirements','skillId'].includes(k))||body.requirements!==undefined&&(typeof body.requirements!=='string'||body.requirements.length>4000||body.requirements.includes('\0'))||body.skillId!==undefined&&body.skillId!==null&&(typeof body.skillId!=='string'||!body.skillId))throw new DomainError('INVALID_INPUT','生成参数无效',400,true);
  if(body.mode!==undefined&&(typeof body.mode!=='string'||!['generate','revise'].includes(body.mode)))throw new DomainError('INVALID_INPUT','规则处理模式无效',400,true);
  const mode=(body.mode as 'generate'|'revise'|undefined)??'generate',requirements=(body.requirements as string|undefined)??'';
  if(mode==='revise'&&!requirements.trim())throw new DomainError('INVALID_INPUT','请提供润色意见',400,true);
  return {mode,requirements,skillId:(body.skillId as string|null|undefined)??null};
 }
 async function generate(id:ProjectRuleIdentity,body:Record<string,unknown>,etag:string,signal:AbortSignal,onProgress?:(e:AgentPreparationProgress)=>void,onPublish?:(sha256:string)=>void){
  const project=d.resolve(id),params=parameters(body);
  if(!etag)throw new DomainError('PRECONDITION_REQUIRED','缺少If-Match',428,true);if(d.store.read(id).writeETag!==etag)throw new DomainError('WRITE_CONFLICT','项目规则已变化',409,true);
  const source=id.scope==='project'?{kind:'project',projectId:id.projectId}:{kind:'workspace',workspaceId:id.workspaceId,projectIds:[id.projectId]};
  const base=d.store.read(id);
  if(base.writeETag!==etag)throw new DomainError('WRITE_CONFLICT','项目规则已变化',409,true);
  if(params.mode==='revise'&&(!base.revision||!base.markdown))throw new DomainError('PROJECT_RULES_REQUIRED','请先生成AGENTS.md再润色',409,true);
  const currentDraft=params.mode==='revise'?{format:3,mode:'generated',scope:source.kind,source,systemPrompt:'',projects:[{id:project.id,name:project.name,rules:base.markdown}]}:undefined;
  const result=await d.prepare.prepare({...params,source,target:'projects',...(currentDraft?{currentDraft,feedback:params.requirements}:{})},signal,onProgress);
  if(signal.aborted)throw new DomainError('REQUEST_ABORTED','生成已取消',409,true);
  const currentProject=d.resolve(id);if(currentProject.id!==project.id||currentProject.rootPath!==project.rootPath)throw new DomainError('WRITE_CONFLICT','项目目录已变化，请重新生成',409,true);const rules=result.definition.projects.find(p=>p.id===project.id)?.rules;if(!rules)throw new DomainError('ROLE_GENERATION_INVALID','未生成项目规则',422,true);
  onPublish?.(createHash('sha256').update(rules).digest('hex'));
  return d.store.write(id,etag,{markdown:rules});
 }
 async function run(id:ProjectRuleIdentity,task:StoredProjectRuleGeneration,controller:AbortController){
  try{
   if(controller.signal.aborted)throw new DomainError('REQUEST_ABORTED','生成已取消',409,true);
   task.status='running';task.startedAt=new Date().toISOString();save(id,task);
   const result=await generate(id,{mode:task.mode??'generate',requirements:task.requirements,skillId:task.skillId},task.baseETag,controller.signal,event=>{task.progress=event;save(id,task);},sha256=>{task.status='publishing';task.resultSha256=sha256;save(id,task);});
   task.status='succeeded';task.resultRevision=result.revision;task.completedAt=new Date().toISOString();task.error=null;save(id,task);
  }catch(error){
   // A successful rule publication is durable even if writing the final task status failed.
   const rules=d.store.read(id);
   if(task.resultSha256===rules.contentSha256&&rules.revision>task.inputRevision){task.status='succeeded';task.resultRevision=rules.revision;task.error=null;}
   else{task.status=controller.signal.aborted?'cancelled':'failed';task.error=controller.signal.aborted?null:error instanceof DomainError?{code:error.code,message:error.message}:{code:'ROLE_GENERATION_FAILED',message:'模型生成失败，请重试'};}
   task.completedAt=new Date().toISOString();save(id,task);
  }finally{if(active.get(identityKey(id))?.task.id===task.id)active.delete(identityKey(id));}
 }
 return {
  read(id:ProjectRuleIdentity){d.resolve(id);return view(id,reconcile(id)[0]);},
  update(id:ProjectRuleIdentity,body:Record<string,unknown>,etag:string){d.resolve(id);if(Object.keys(body).some(k=>k!=='enabled')||typeof body.enabled!=='boolean')throw new DomainError('INVALID_INPUT','请提供启用开关',400,true);const tasks=reconcile(id);d.store.write(id,etag,{enabled:body.enabled});return view(id,tasks[0]);},
  generate,
  start(id:ProjectRuleIdentity,body:Record<string,unknown>,etag:string,requestKey:string):ProjectRulesStatus {
   d.resolve(id);const params=parameters(body);
   if(!/^[\x21-\x7e]{1,128}$/.test(requestKey))throw new DomainError('INVALID_IDEMPOTENCY_KEY','缺少有效的Idempotency-Key',400,true);
   if(!etag)throw new DomainError('PRECONDITION_REQUIRED','缺少If-Match',428,true);
   const tasks=reconcile(id),previous=tasks.find(t=>t.requestKey===requestKey);
   if(previous){if(previous.baseETag!==etag||(previous.mode??'generate')!==params.mode||previous.requirements!==params.requirements||previous.skillId!==params.skillId)throw new DomainError('IDEMPOTENCY_CONFLICT','请求键已用于其他生成参数',409,true);return view(id,previous);}
   if(active.has(identityKey(id))||tasks.some(t=>activeGeneration(t.status)))throw new DomainError('PROJECT_RULE_GENERATION_BUSY','项目规则正在生成，请等待或取消当前任务',409,true);
   const rules=d.store.read(id);if(rules.writeETag!==etag)throw new DomainError('WRITE_CONFLICT','项目规则已变化',409,true);
   if(params.mode==='revise'&&(!rules.revision||!rules.markdown))throw new DomainError('PROJECT_RULES_REQUIRED','请先生成AGENTS.md再润色',409,true);
   if(params.skillId!==null)d.prepare.skill(params.skillId);
   const now=new Date(Math.max(Date.now(),tasks[0]?Date.parse(tasks[0].createdAt)+1:0)).toISOString();
   const task:StoredProjectRuleGeneration={id:randomUUID(),status:'queued',...params,requestKey,baseETag:etag,inputRevision:rules.revision,createdAt:now,updatedAt:now,startedAt:null,completedAt:null,progress:null,resultRevision:null,resultSha256:null,error:null};
   d.generations.save(id,task);const controller=new AbortController();active.set(identityKey(id),{task,controller});
   setImmediate(()=>{void run(id,task,controller).catch(()=>{/* Durable state is reconciled on the next read. */});});
   return view(id,task);
  },
  cancel(id:ProjectRuleIdentity,body:Record<string,unknown>):ProjectRulesStatus {
   d.resolve(id);if(Object.keys(body).some(k=>!['generationId','action'].includes(k))||body.action!=='cancel'||typeof body.generationId!=='string')throw new DomainError('INVALID_INPUT','请选择需要取消的生成任务',400,true);
   const task=reconcile(id).find(t=>t.id===body.generationId);if(!task)throw new DomainError('NOT_FOUND','生成任务不存在',404,true);
   const running=active.get(identityKey(id));if(activeGeneration(task.status)&&running?.task.id===task.id){running.task.status='cancelling';save(id,running.task);running.controller.abort();return view(id,running.task);}
   return view(id,task);
  }
 };
}
