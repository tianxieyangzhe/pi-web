require('./register.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Database=require('better-sqlite3');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {targetSchema}=require('../src/infrastructure/database/schema.server.ts');
const {createBotRepository}=require('../src/infrastructure/database/bot-repository.ts');
const {createBotService}=require('../src/application/bot-service.ts');
const {recoverBotRuntimeOnce}=require('../src/bootstrap/bot-runtime-recovery.ts');
const {writeAgentVersion}=require('../src/infrastructure/agents/agent-file-store.server.ts');
const {hydrateAgentSnapshot,serializeAgentSnapshot}=require('../src/infrastructure/database/agent-snapshot.server.ts');
const {DomainError}=require('../src/domain/errors.ts');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let i=0;i<400;i++){if(fn())return;await sleep(5);}assert.fail('Bot 调度未在预期时间内收敛');}

function fixture(run,options={}){
  process.env.AI_WORKSPACE_AGENT_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'bot-agent-redesign-'));
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec(targetSchema);let sequence=0;
  const projectRoot=options.projectRoot??'/tmp/bot-project',workingDirectory=options.workingDirectory??'/tmp/bot-workspace';
  db.prepare("INSERT INTO projects VALUES('p','项目',NULL,'code',?,'active','now','now')").run(projectRoot);
  const repository=createBotRepository(db),agents=new Map();
  const addAgent=(agentId,kind)=>{const description=kind==='project'?options.projectAgentDescription??null:null,definition={instructions:`${kind} 指导`,capabilities:{readFiles:true,writeFiles:kind==='project',readProjects:false,dispatchTasks:kind==='coordinator'&&options.dispatchTasks!==false,dispatchProjectWrites:kind==='coordinator'&&options.dispatchTasks!==false,exchangeMessages:true}},file=writeAgentVersion({agentId,revision:1,kind,name:agentId,description,definition}),agent={id:agentId,name:agentId,description,kind,botId:null,projectId:null,sourceTemplateId:null,definition,revision:1,contentSha256:file.contentSha256,status:'active',createdAt:'now',updatedAt:'now'};agents.set(agentId,agent);db.prepare("INSERT INTO agents(id,name,description,kind,bot_id,project_id,source_template_id,definition_json,extension_json,policy_json,revision,content_sha256,status,created_at,updated_at) VALUES(?,?,?,?,NULL,NULL,NULL,NULL,'{}','{}',1,?,'active','now','now')").run(agentId,agentId,description,kind,file.contentSha256);return agent;};
  addAgent('project-agent','project');
  function mapSession(row){return row?{id:row.id,sessionMemoryId:row.session_memory_id,projectId:row.project_id,purpose:row.purpose,status:row.status,botConversationId:row.bot_conversation_id,participantName:row.participant_name,assignment:row.assignment,collaborationState:row.collaboration_state,botJoinedAt:row.bot_joined_at,updatedAt:row.updated_at,agentId:row.agent_id,agentSnapshot:row.agent_snapshot_json?hydrateAgentSnapshot(JSON.parse(row.agent_snapshot_json)):null,mcpIds:[],mcpSnapshots:[],state:row.state,nativeRef:row.native_ref_json?JSON.parse(row.native_ref_json):null,nativeMetadata:JSON.parse(row.native_metadata_json||'{}'),createdAt:row.created_at,lastActivityAt:row.last_activity_at,endedAt:row.ended_at}:null;}
  const sessions={get:id=>mapSession(db.prepare('SELECT * FROM sessions WHERE id=?').get(id)),listForProject:projectId=>db.prepare('SELECT * FROM sessions WHERE project_id=? ORDER BY created_at,id').all(projectId).map(mapSession),updateRuntime(id,patch){const values=[];if(patch.state!==undefined){values.push(`state='${patch.state}'`);}if(patch.nativeRef){values.push('native_ref_json=?');}if(!values.length)return this.get(id);const sql=values.filter(value=>value.includes('?')).join(',');if(sql)db.prepare(`UPDATE sessions SET ${sql} WHERE id=?`).run(JSON.stringify(patch.nativeRef),id);else db.prepare(`UPDATE sessions SET ${values.join(',')} WHERE id=?`).run(id);return this.get(id);}};
  const memories={get:id=>({id,projectId:'p',contextJson:{summary:'',goal:'',constraints:[],facts:[],decisions:[],nextActions:[],outputs:[]}}),createSession(projectId,purpose,_template,_etag,role){const sessionId=role.stableId??`session-${++sequence}`,memoryId=`memory-${sessionId}`,context={summary:'',goal:'',constraints:[],facts:[],decisions:[],nextActions:[],outputs:[]};db.prepare("INSERT INTO session_memories(id,project_id,source_template_id,title,context_json,draft_json,last_reviewed_entry_id,created_at,updated_at) VALUES(?,?,NULL,'独有项目记忆',?,NULL,NULL,'now','now')").run(memoryId,projectId,JSON.stringify(context));db.prepare("INSERT INTO sessions(id,session_memory_id,project_id,purpose,agent_id,agent_snapshot_json,mcp_ids_json,mcp_snapshots_json,status,state,native_ref_json,native_metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,'[]','[]','open','not_started',NULL,'{}','now','now')").run(sessionId,memoryId,projectId,purpose,role.agentId,JSON.stringify(serializeAgentSnapshot(role.agentSnapshot)));return this.get(sessionId);}};
  const projects={get:id=>id==='p'?{id:'p',name:'项目',rootPath:projectRoot,status:'active'}:null,list:()=>[{id:'p',name:'项目',rootPath:projectRoot,status:'active'}]};
  const runtime={run:run??(async(input,content,onRef)=>{onRef({kind:'pi',sessionFile:`/tmp/${input.identity}.jsonl`,sessionId:input.identity,cwd:input.cwd});return{startId:'start',endId:'end',evidence:[{id:`evidence:${input.executionId}`,kind:'assistant',text:'已完成',failed:false}],result:{summary:'已完成',verification:'not_run',checks:[],outputs:[],blockers:[]},messageEntryIds:messageEntries(input,content)};}),abort:async()=>{},steer:async()=>{},inspect:async()=>({}),compact:async()=>{},cancelCompaction:()=>{},messages:async()=>[],resolve:async()=>({endId:null,evidence:[],result:null}),resolveMessageDelivery:async()=>null};
  const catalog={getAgent:id=>agents.get(id)??null,getAgentVersion:(id,revision,sha)=>{const value=agents.get(id);return value&&value.revision===revision&&value.contentSha256===sha?value:null;}};
  const service=createBotService({repository,workspace:{create:async()=>({workingDirectory,workspaceKind:'managed'}),validate:async()=>{},sessionDirectory:()=>'/tmp/bot-sessions'},runtime,runtimeInstanceId:'test-process',sessions,projects,memories,catalog});
  const create=service.create.bind(service);
  service.create=async(body={})=>{if(!agents.has('coordinator'))addAgent('coordinator','coordinator');return create({...body,coordinatorAgentId:'coordinator',projectBindings:body.projectBindings??[{projectId:'p',agentIds:['project-agent']}]});};
  return {db,repository,service,sessions,memories,agents,runtime};
}

function messageEntries(input,content){
  const found=Object.fromEntries([...content.matchAll(/\[BOT_MESSAGE:([^\]]+)\]/g)].map(match=>[match[1],`entry:${match[1]}`]));
  return input.triggerMessageId?{[input.triggerMessageId]:`entry:${input.triggerMessageId}`,...found}:found;
}

function evidenceResult(executionId,task){
  const id=`evidence:${executionId}`;
  return {summary:`完成 ${task.title}`,verification:'passed',checks:task.acceptanceCriteria.map(criterion=>({criterion,outcome:'passed',evidence:'已检查',sourceEntryIds:[id]})),outputs:[],blockers:[]};
}

test('协调者显式创建 Work、首次新建 Session、后续相关 Work 复用同一 Session',async()=>{
  let targetSessionId=null,projectSessionCreates=0,workStarts=0,directoryVerified=false;
  const f=fixture(async(input,content,onRef)=>{
    const execution=f.repository.get('bot_executions',input.executionId),task=execution.taskId?f.repository.get('bot_tasks',execution.taskId):null;
    onRef({kind:'pi',sessionFile:`/tmp/${input.identity}.jsonl`,sessionId:input.identity,cwd:input.cwd});
    const messageEntryIds=messageEntries(input,content);
    if(input.projectSessionId){return{startId:'project-start',endId:'project-end',evidence:[{id:`evidence:${input.executionId}`,kind:'tool',text:'project_read: README.md',failed:false}],result:evidenceResult(input.executionId,task),messageEntryIds};}
    if(execution.triggerMessageId&&execution.workId){
      const projectPage=await input.tools.find(tool=>tool.name==='bot_project_directory').execute({before:null,limit:5}),
        sessionPage=await input.tools.find(tool=>tool.name==='bot_session_directory').execute({projectId:'p',before:null,limit:10}),
        sessionContext=await input.tools.find(tool=>tool.name==='bot_session_context').execute({sessionId:targetSessionId}),
        definition=await input.tools.find(tool=>tool.name==='bot_agent_definition').execute({projectId:'p',agentId:'project-agent'});
      assert.equal(projectPage.projects[0].projectId,'p');assert.equal(sessionPage.sessions[0].sessionId,targetSessionId);assert.equal(sessionContext.tasks.length,workStarts);assert.equal(definition.untrustedReference,true);assert.ok(definition.instructions.includes('project 指导'));directoryVerified=true;
      assert.equal(sessionPage.sessions[0].reusable,true);assert.match(sessionPage.sessions[0].reuseReason,/可复用/);
      return{startId:'coord-start',endId:'coord-end',evidence:[],result:{summary:'已验收项目结果并汇总',verification:'not_run',checks:[],outputs:[],blockers:[],workOutcome:'completed'},messageEntryIds};
    }
    if(execution.triggerMessageId&&execution.input.includes('先简单讨论'))return{startId:'coord-start',endId:'coord-end',evidence:[],result:{summary:'普通交流，不创建工作',verification:'not_run',checks:[],outputs:[],blockers:[]},messageEntryIds};
    assert(input.tools.some(tool=>tool.name==='bot_project_directory'));assert(!input.tools.some(tool=>tool.name==='bot_project_search'));
    const start=input.tools.find(tool=>tool.name==='bot_start_work'),createTask=input.tools.find(tool=>tool.name==='bot_create_task');
    assert.ok(start);assert.ok(createTask);
    const work=await start.execute({title:`Work ${++workStarts}`,goal:execution.input});
    const reuse=workStarts>1;
    const receipt=await createTask.execute({workId:work.id,sessionMode:reuse?'reuse':'new',sessionId:reuse?targetSessionId:null,projectId:reuse?null:'p',agentId:reuse?null:'project-agent',topic:reuse?null:'代码分析',creationReason:reuse?null:'首次处理此项目主题',title:`Task ${workStarts}`,instruction:'阅读并检查相关项目实现',acceptanceCriteria:['核实项目事实'],operation:'read',dependsOn:[]});
    const liveSessionDirectory=await input.tools.find(tool=>tool.name==='bot_session_directory').execute({projectId:'p',before:null,limit:10});
    assert.equal(liveSessionDirectory.sessions[0].reusable,true);assert.match(liveSessionDirectory.sessions[0].reuseReason,/可复用/);
    targetSessionId=receipt.targetSessionId;if(!reuse)projectSessionCreates++;
    return{startId:'coord-start',endId:'coord-end',evidence:[],result:{summary:'工作已拆分并排队',verification:'not_run',checks:[],outputs:[],blockers:[]},messageEntryIds};
  });
  const bot=await f.service.create({name:'协作'}),conversation=f.service.createConversation(bot.id,{});
  f.service.send(bot.id,conversation.id,'请首次分析代码','first-request');
  await until(()=>f.service.detail(bot.id,conversation.id).works.some(work=>work.status==='completed')&&!f.service.detail(bot.id,conversation.id).busy);
  const first=f.service.detail(bot.id,conversation.id),firstWork=first.works[0],firstTask=first.tasks.find(task=>task.workId===firstWork.id);
  assert.equal(firstWork.status,'completed');assert.equal(firstTask.status,'completed');assert.equal(firstTask.creationReason,'首次处理此项目主题');assert.ok(targetSessionId);assert.equal(directoryVerified,true);
  assert.equal(projectSessionCreates,1);assert.equal(first.participants.length,1);assert.equal(f.repository.list('bot_executions',{taskId:firstTask.id})[0].status,'completed');
  f.service.send(bot.id,conversation.id,'继续相关工作，再检查一个细节','second-request');
  await until(()=>f.service.detail(bot.id,conversation.id).works.filter(work=>work.status==='completed').length===2&&!f.service.detail(bot.id,conversation.id).busy);
  const second=f.service.detail(bot.id,conversation.id),secondTask=second.tasks.find(task=>task.workId===second.works.find(work=>work.id!==firstWork.id).id);
  assert.equal(secondTask.targetSessionId,firstTask.targetSessionId);assert.equal(second.participants.length,1);assert.equal(projectSessionCreates,1);
  assert.equal(second.conversation.status,'open');assert.equal(second.conversation.schedulingMode,'enabled');
  f.service.control(bot.id,conversation.id,'pause');
  f.service.send(bot.id,conversation.id,'继续相关工作时先简单讨论，不要派发','paused-chat');
  await until(()=>f.service.detail(bot.id,conversation.id).messages.find(message=>message.idempotencyKey==='paused-chat')?.deliveryStatus==='delivered');
  const paused=f.service.detail(bot.id,conversation.id);assert.equal(paused.conversation.schedulingMode,'paused');assert.equal(paused.works.length,2);assert.equal(paused.conversation.status,'open');assert.equal(paused.canAcceptUserMessage,true);assert.equal(paused.canDispatchProjectTask,false);assert.ok(paused.allowedActions.some(action=>action.action==='resume_project_scheduling'));assert.doesNotThrow(()=>f.service.assertSessionAllowed(targetSessionId));
  f.db.close();
});

test('project_write Task preserves the operation and reaches the Project Session with write tools enabled',async()=>{
  let observed=null;
  const f=fixture(async(input,content,onRef)=>{
    const execution=f.repository.get('bot_executions',input.executionId),task=execution.taskId?f.repository.get('bot_tasks',execution.taskId):null;
    onRef({kind:'pi',sessionFile:`/tmp/${input.identity}.jsonl`,sessionId:input.identity,cwd:input.cwd});
    const messageEntryIds=messageEntries(input,content);
    if(input.projectSessionId){
      const evidenceId=`evidence:${execution.id}`;
      observed={operation:execution.operation,allowWrite:input.allowWrite};
      return{startId:'project-start',endId:'project-end',evidence:[{id:evidenceId,kind:'tool',text:'project_edit: src/config.ts',failed:false}],result:{summary:'配置已更新',verification:'passed',checks:task.acceptanceCriteria.map(criterion=>({criterion,outcome:'passed',evidence:'已检查配置变更',sourceEntryIds:[evidenceId]})),outputs:[],blockers:[]},messageEntryIds};
    }
    const work=await input.tools.find(tool=>tool.name==='bot_start_work').execute({title:'修改配置',goal:'修改项目配置并核验'});
    await input.tools.find(tool=>tool.name==='bot_create_task').execute({workId:work.id,sessionMode:'new',sessionId:null,projectId:'p',agentId:'project-agent',topic:'配置调整',creationReason:'需要建立独立修改上下文',title:'更新配置',instruction:'修改并核验配置',acceptanceCriteria:['配置变更已核验'],operation:'project_write',dependsOn:[]});
    return{startId:'coord-start',endId:'coord-end',evidence:[],result:{summary:'修改任务已派发',verification:'not_run',checks:[],outputs:[],blockers:[]},messageEntryIds};
  });
  const bot=await f.service.create({name:'修改权限'}),conversation=f.service.createConversation(bot.id,{});
  f.service.send(bot.id,conversation.id,'请修改项目配置','project-write-task');
  await until(()=>observed&&f.repository.list('bot_executions',{conversationId:conversation.id}).some(execution=>execution.taskId&&execution.status==='completed'));
  const task=f.repository.list('bot_tasks',{conversationId:conversation.id})[0],execution=f.repository.list('bot_executions',{taskId:task.id})[0];
  assert.equal(task.operation,'project_write');assert.equal(execution.operation,'project_write');assert.deepEqual(observed,{operation:'project_write',allowWrite:true});assert.equal(task.status,'completed');
  f.db.close();
});

test('Session routing directory includes bounded waiting question text and Bot-wide parallel queue reason',async()=>{
  let observedQuestion=null;
  const f=fixture(async(input,content,onRef)=>{
    const execution=f.repository.get('bot_executions',input.executionId),task=execution.taskId?f.repository.get('bot_tasks',execution.taskId):null;
    onRef({kind:'pi',sessionFile:`/tmp/${input.identity}.jsonl`,sessionId:input.identity,cwd:input.cwd});
    const messageEntryIds=messageEntries(input,content);
    if(input.projectSessionId){
      await input.tools.find(tool=>tool.name==='bot_message').execute({targetSessionId:null,content:`请确认接口是否需要兼容旧配置：${'细节'.repeat(250)}`,kind:'question',replyToMessageId:null});
      return{startId:'project-start',endId:'project-end',evidence:[{id:`evidence:${execution.id}`,kind:'tool',text:'project_read: README.md',failed:false}],result:evidenceResult(execution.id,task),messageEntryIds};
    }
    const trigger=execution.triggerMessageId?f.repository.get('bot_messages',execution.triggerMessageId):null;
    if(trigger?.kind==='question'){
      const directory=await input.tools.find(tool=>tool.name==='bot_session_directory').execute({projectId:'p',before:null,limit:10}),
        context=await input.tools.find(tool=>tool.name==='bot_session_context').execute({sessionId:taskTargetSessionId});
      observedQuestion={directory,context};
    }else if(trigger?.sourceKind==='user'){
      const work=await input.tools.find(tool=>tool.name==='bot_start_work').execute({title:'核对接口',goal:'检查接口兼容性'}),
        receipt=await input.tools.find(tool=>tool.name==='bot_create_task').execute({workId:work.id,sessionMode:'new',sessionId:null,projectId:'p',agentId:'project-agent',topic:'接口兼容性',creationReason:'首次处理此主题',title:'确认兼容要求',instruction:'检查接口约束并确认待答问题',acceptanceCriteria:['接口结论有证据'],operation:'read',dependsOn:[]});
      taskTargetSessionId=receipt.targetSessionId;
    }
    return{startId:'coord-start',endId:'coord-end',evidence:[],result:{summary:'协作状态已记录',verification:'not_run',checks:[],outputs:[],blockers:[]},messageEntryIds};
  });
  let taskTargetSessionId=null;
  const bot=await f.service.create({name:'目录待答测试'}),conversation=f.service.createConversation(bot.id,{});
  f.service.send(bot.id,conversation.id,'请确认接口兼容性','pending-question');
  await until(()=>!!observedQuestion);
  const questionTask=observedQuestion.directory.sessions.flatMap(session=>session.tasks).find(item=>item.pendingQuestion?.available);
  assert.ok(questionTask);
  assert.equal(questionTask.pendingQuestion.messageId,questionTask.waitingForMessageId);
  assert.ok(questionTask.pendingQuestion.excerpt.includes('请确认接口是否需要兼容旧配置'));
  assert.equal(questionTask.pendingQuestion.excerpt.length,400);
  assert.equal(questionTask.pendingQuestion.truncated,true);
  const contextTask=observedQuestion.context.tasks.find(item=>item.taskId===questionTask.taskId);
  assert.equal(contextTask.pendingQuestion.messageId,questionTask.waitingForMessageId);
  assert.equal(contextTask.pendingQuestion.excerpt.length,400);
  f.db.close();
});

test('Bot project concurrency queue reason counts running work from its other conversations',async()=>{
  let firstProjectStartedResolve,releaseFirstProject;
  const firstProjectStarted=new Promise(resolve=>{firstProjectStartedResolve=resolve;}),firstProjectHold=new Promise(resolve=>{releaseFirstProject=resolve;});
  let firstConversationId=null,secondConversationId=null,secondDirectory=null,unexpectedSecondProjectRun=false;
  const f=fixture(async(input,content,onRef)=>{
    const execution=f.repository.get('bot_executions',input.executionId),task=execution.taskId?f.repository.get('bot_tasks',execution.taskId):null;
    onRef({kind:'pi',sessionFile:`/tmp/${input.identity}.jsonl`,sessionId:input.identity,cwd:input.cwd});
    const messageEntryIds=messageEntries(input,content);
    if(input.projectSessionId){
      if(execution.conversationId===firstConversationId){
        firstProjectStartedResolve();await firstProjectHold;
      }else unexpectedSecondProjectRun=true;
      return{startId:'project-start',endId:'project-end',evidence:[{id:`evidence:${execution.id}`,kind:'tool',text:'project_read: README.md',failed:false}],result:evidenceResult(execution.id,task),messageEntryIds};
    }
    if(execution.triggerMessageId){
      const work=await input.tools.find(tool=>tool.name==='bot_start_work').execute({title:'并发检查',goal:'执行项目检查'}),
        receipt=await input.tools.find(tool=>tool.name==='bot_create_task').execute({workId:work.id,sessionMode:'new',sessionId:null,projectId:'p',agentId:'project-agent',topic:`独立任务 ${execution.conversationId}`,creationReason:'需要独立任务上下文',title:'检查项目',instruction:'检查项目实现',acceptanceCriteria:['检查完成'],operation:'read',dependsOn:[]});
      if(execution.conversationId===secondConversationId){
        const directory=await input.tools.find(tool=>tool.name==='bot_session_directory').execute({projectId:'p',before:null,limit:10});
        secondDirectory=directory.sessions.find(session=>session.sessionId===receipt.targetSessionId);
      }
    }
    return{startId:'coord-start',endId:'coord-end',evidence:[],result:{summary:'项目工作已排队',verification:'not_run',checks:[],outputs:[],blockers:[]},messageEntryIds};
  });
  const bot=await f.service.create({name:'跨对话并发测试'});
  f.db.prepare('UPDATE bots SET max_parallel_executions=1 WHERE id=?').run(bot.id);
  const first=f.service.createConversation(bot.id,{}),second=f.service.createConversation(bot.id,{});
  firstConversationId=first.id;secondConversationId=second.id;
  f.service.send(bot.id,first.id,'检查项目一','first-concurrency');
  await firstProjectStarted;
  f.service.send(bot.id,second.id,'检查项目二','second-concurrency');
  await until(()=>!!secondDirectory&&f.service.detail(bot.id,second.id).executions.some(item=>item.status==='queued'&&item.targetSessionId));
  assert.ok(secondDirectory.queueReasons.some(reason=>reason.includes('Bot 项目并发额度已满（1/1）')));
  assert.ok(f.service.detail(bot.id,second.id).blockingReasons.some(reason=>reason.entityType==='execution'&&reason.reason==='Bot 项目并发额度已满'));
  assert.equal(unexpectedSecondProjectRun,false);
  releaseFirstProject();
  await until(()=>f.service.detail(bot.id,first.id).tasks.some(item=>item.status==='completed')&&f.service.detail(bot.id,second.id).tasks.some(item=>item.status==='completed'));
  f.db.close();
});

test('协调者即使无派发能力也能用 Project Directory 感知范围且不能读重叠项目目录',async()=>{
  const projectRoot=fs.mkdtempSync(path.join(os.tmpdir(),'bot-directory-project-'));let seenTools=[],allowRead=true,directory;
  const f=fixture(async(input,content,onRef)=>{
    seenTools=input.tools.map(tool=>tool.name);allowRead=input.allowRead===true;
    onRef({kind:'pi',sessionFile:`/tmp/${input.identity}.jsonl`,sessionId:input.identity,cwd:input.cwd});
    directory=await input.tools.find(tool=>tool.name==='bot_project_directory').execute({before:null,limit:10});
    const messageId=input.triggerMessageId;
    return{startId:'start',endId:'end',evidence:[],result:{summary:'已查询项目范围',verification:'not_run',checks:[],outputs:[],blockers:[]},messageEntryIds:messageId?{[messageId]:'entry'}:{}};
  },{dispatchTasks:false,projectRoot,workingDirectory:projectRoot,projectAgentDescription:'负责项目源码分析与接口核验'});
  const bot=await f.service.create({name:'项目感知'}),conversation=f.service.createConversation(bot.id,{}),message=f.service.send(bot.id,conversation.id,'有哪些项目？','scope-awareness');
  const execution=f.repository.list('bot_executions',{conversationId:conversation.id})[0];
  await until(()=>f.repository.get('bot_executions',execution.id).status==='completed');
  assert(seenTools.includes('bot_project_directory'));assert(seenTools.includes('bot_session_directory'));assert(seenTools.includes('bot_agent_definition'));
  assert(!seenTools.includes('bot_project_search'));assert(!seenTools.includes('bot_start_work'));assert(!seenTools.includes('bot_create_task'));assert.equal(allowRead,false);
  assert.deepEqual(directory.projects.map(project=>project.projectId),['p']);assert.equal(directory.projects[0].projectStatus,'active');assert.equal(directory.projects[0].agents[0].responsibilitySummary,'负责项目源码分析与接口核验');
  assert.equal(f.repository.get('bot_messages',message.id).deliveryStatus,'delivered');assert.equal(f.repository.list('bot_works',{conversationId:conversation.id}).length,0);
  f.db.close();
});

test('Project Directory 始终提供范围感知而协调 Bot 工作区不得触及重叠 Project',async()=>{
  const projectRoot=fs.mkdtempSync(path.join(os.tmpdir(),'bot-project-root-'));let seenTools=[],seenAllowRead=true,directoryResult;
  const f=fixture(async(input,content,onRef)=>{
    seenTools=input.tools.map(tool=>tool.name);seenAllowRead=input.allowRead===true;
    onRef({kind:'pi',sessionFile:`/tmp/${input.identity}.jsonl`,sessionId:input.identity,cwd:input.cwd});
    directoryResult=await input.tools.find(tool=>tool.name==='bot_project_directory').execute({before:null,limit:10});
    return{startId:'start',endId:'end',evidence:[],result:{summary:'已读取协作范围目录',verification:'not_run',checks:[],outputs:[],blockers:[]},messageEntryIds:messageEntries(input,content)};
  },{dispatchTasks:false,projectRoot,workingDirectory:projectRoot});
  const bot=await f.service.create({name:'只读目录'}),conversation=f.service.createConversation(bot.id,{}),message=f.service.send(bot.id,conversation.id,'有哪些项目可以协调？','directory-only');
  await until(()=>f.repository.list('bot_executions',{conversationId:conversation.id}).some(execution=>execution.status==='completed'));
  assert(seenTools.includes('bot_project_directory'));assert(seenTools.includes('bot_session_directory'));assert(!seenTools.includes('bot_project_search'));assert(!seenTools.includes('bot_create_task'));assert(!seenTools.includes('bot_start_work'));assert.equal(seenAllowRead,false);
  assert.equal(directoryResult.projects[0].projectId,'p');assert.equal(directoryResult.projects[0].projectName,'项目');assert.equal(directoryResult.projects[0].projectStatus,'active');
  assert.equal(f.repository.get('bot_messages',message.id).deliveryStatus,'delivered');assert.equal(f.repository.list('bot_works',{conversationId:conversation.id}).length,0);
  f.db.close();
});

test('请求期间重复触发启动恢复不会把活动用户请求误标 unknown',async()=>{
  let notifyStarted,continueRuntime;const started=new Promise(resolve=>notifyStarted=resolve),resume=new Promise(resolve=>continueRuntime=resolve),processState={};
  const f=fixture(async(input,content,onRef)=>{
    onRef({kind:'pi',sessionFile:`/tmp/${input.identity}.jsonl`,sessionId:input.identity,cwd:input.cwd});
    notifyStarted({input,content});await resume;
    const work=await input.tools.find(tool=>tool.name==='bot_start_work').execute({title:'定位 main 函数',goal:'在 oam 项目定位 main 函数入口'});
    return{startId:'start',endId:'end',evidence:[],result:{summary:'Work 已创建',verification:'not_run',checks:[],outputs:[],blockers:[]},messageEntryIds:messageEntries(input,content)};
  });
  recoverBotRuntimeOnce(f.repository,'test-process',processState);
  const bot=await f.service.create({name:'恢复隔离'}),conversation=f.service.createConversation(bot.id,{}),message=f.service.send(bot.id,conversation.id,'在 oam 找到 main 函数','runtime-recovery');
  const active=await started,execution=f.repository.list('bot_executions',{conversationId:conversation.id})[0];
  assert.equal(execution.status,'running');assert.equal(f.repository.get('bot_messages',message.id).deliveryStatus,'delivering');
  assert.equal(recoverBotRuntimeOnce(f.repository,'test-process',processState),false);
  assert.equal(f.repository.get('bot_executions',execution.id).status,'running');assert.equal(f.repository.get('bot_messages',message.id).deliveryStatus,'delivering');
  assert.equal(active.input.triggerMessageId,message.id);
  continueRuntime();
  await until(()=>f.repository.get('bot_executions',execution.id).status==='completed');
  const work=f.repository.list('bot_works',{conversationId:conversation.id})[0];
  assert.ok(work);assert.equal(work.originMessageId,message.id);assert.equal(f.repository.get('bot_executions',execution.id).workId,work.id);assert.equal(f.repository.get('bot_messages',message.id).deliveryStatus,'delivered');
  f.db.close();
});

test('停止指定 Work 等待 Runtime 确认结束后才释放执行锁并取消 Task',async()=>{
  let projectStarted;const started=new Promise(resolve=>projectStarted=resolve);
  const f=fixture(async(input,content,onRef)=>{
    const execution=f.repository.get('bot_executions',input.executionId);onRef({kind:'pi',sessionFile:`/tmp/${input.identity}.jsonl`,sessionId:input.identity,cwd:input.cwd});
    if(input.projectSessionId){projectStarted(execution);await new Promise((resolve,reject)=>{input.signal.addEventListener('abort',()=>reject(new DomainError('REQUEST_ABORTED','执行已停止',409,true)), {once:true});});}
    if(execution.triggerMessageId&&!execution.workId){const work=await input.tools.find(tool=>tool.name==='bot_start_work').execute({title:'停止测试',goal:'在途项目任务'});await input.tools.find(tool=>tool.name==='bot_create_task').execute({workId:work.id,sessionMode:'new',sessionId:null,projectId:'p',agentId:'project-agent',topic:'阻塞分析',creationReason:'独立主题',title:'阻塞任务',instruction:'执行并等待停止',acceptanceCriteria:['提供结果'],operation:'read',dependsOn:[]});}
    return{startId:'start',endId:'end',evidence:[],result:{summary:'讨论完成',verification:'not_run',checks:[],outputs:[],blockers:[]},messageEntryIds:{}};
  });
  const bot=await f.service.create({name:'停止'}),conversation=f.service.createConversation(bot.id,{});f.service.send(bot.id,conversation.id,'开始并停止项目工作','stop-request');
  const running=await started;const work=f.repository.list('bot_works',{conversationId:conversation.id})[0],task=f.repository.list('bot_tasks',{workId:work.id})[0];
  const stopped=await f.service.stopWork(bot.id,conversation.id,work.id);assert.equal(stopped.works.find(item=>item.id===work.id).status,'cancelled');assert.equal(f.repository.get('bot_executions',running.id).status,'cancelled');assert.ok(f.repository.get('bot_executions',running.id).cancelRequestedAt);assert.equal(f.repository.get('bot_tasks',task.id).status,'cancelled');
  assert.equal(f.service.detail(bot.id,conversation.id).conversation.status,'open');f.db.close();
});

test('项目 Session 停止可取消排队执行，并等待活动 Runtime 确认中止',async()=>{
  const started=new Map(),notify=new Map();
  const f=fixture(async(input,content,onRef)=>{
    const execution=f.repository.get('bot_executions',input.executionId),messageEntryIds=messageEntries(input,content);
    onRef({kind:'pi',sessionFile:`/tmp/${input.identity}.jsonl`,sessionId:input.identity,cwd:input.cwd});
    if(input.projectSessionId){
      started.set(execution.conversationId,execution);notify.get(execution.conversationId)?.(execution);
      await new Promise((resolve,reject)=>input.signal.addEventListener('abort',()=>reject(new DomainError('REQUEST_ABORTED','执行已停止',409,true)),{once:true}));
    }
    if(execution.triggerMessageId&&!execution.workId){
      const work=await input.tools.find(tool=>tool.name==='bot_start_work').execute({title:'Session 停止测试',goal:'检查指定 Session 的停止行为'});
      await input.tools.find(tool=>tool.name==='bot_create_task').execute({workId:work.id,sessionMode:'new',sessionId:null,projectId:'p',agentId:'project-agent',topic:'停止测试',creationReason:'隔离停止边界',title:'检查项目',instruction:'检查项目 Session 停止行为',acceptanceCriteria:['执行可停止'],operation:'read',dependsOn:[]});
    }
    return{startId:'start',endId:'end',evidence:[],result:{summary:'协作请求已处理',verification:'not_run',checks:[],outputs:[],blockers:[]},messageEntryIds};
  });
  const bot=await f.service.create({name:'Session 停止'});f.db.prepare('UPDATE bots SET max_parallel_executions=1 WHERE id=?').run(bot.id);
  const running=f.service.createConversation(bot.id,{}),projectStarted=new Promise(resolve=>notify.set(running.id,resolve));
  f.service.send(bot.id,running.id,'创建运行任务','running-stop');
  const runningExecution=await projectStarted;
  const queued=f.service.createConversation(bot.id,{});f.service.send(bot.id,queued.id,'创建排队任务','queue-stop');
  await until(()=>f.service.detail(bot.id,queued.id).tasks.length===1&&f.service.detail(bot.id,queued.id).executions.some(item=>item.targetSessionId&&item.status==='queued'));
  const queuedDetail=f.service.detail(bot.id,queued.id),queuedTask=queuedDetail.tasks[0],queuedExecution=queuedDetail.executions.find(item=>item.taskId===queuedTask.id);
  assert.equal(await f.service.interruptSession(queuedTask.targetSessionId),true);
  assert.equal(f.repository.get('bot_executions',queuedExecution.id).status,'cancelled');
  assert.equal(f.repository.get('bot_tasks',queuedTask.id).status,'cancelled');
  assert.equal(started.has(queued.id),false);
  assert.equal(f.repository.get('bot_executions',runningExecution.id).status,'running');
  assert.equal(await f.service.interruptSession(runningExecution.targetSessionId),true);
  assert.equal(f.repository.get('bot_executions',runningExecution.id).status,'cancelled');
  assert.equal(f.repository.get('bot_tasks',runningExecution.taskId).status,'cancelled');
  assert.equal(f.sessions.get(runningExecution.targetSessionId).state,'idle');
  f.db.close();
});

test('投递失败仍保留准确用户消息标记，执行失败不会关闭总对话',async()=>{
  let calls=0;const f=fixture(async(input,content,onRef)=>{calls++;onRef({kind:'pi',sessionFile:`/tmp/${input.identity}.jsonl`,sessionId:input.identity,cwd:input.cwd});const markers=messageEntries(input,content);if(calls===1)throw Object.assign(new DomainError('BOT_MODEL_UNAVAILABLE','模型不可用',503,true),{messageEntryIds:markers});return{startId:'start',endId:'end',evidence:[],result:{summary:'可以继续交流',verification:'not_run',checks:[],outputs:[],blockers:[]},messageEntryIds:markers};});
  const bot=await f.service.create({name:'恢复'}),conversation=f.service.createConversation(bot.id,{}),message=f.service.send(bot.id,conversation.id,'普通问题','model-failure');
  await until(()=>f.repository.list('bot_executions',{conversationId:conversation.id}).some(execution=>execution.status==='failed'));
  assert.equal(f.repository.get('bot_messages',message.id).deliveryStatus,'delivered');assert.equal(f.service.detail(bot.id,conversation.id).conversation.status,'open');
  f.service.send(bot.id,conversation.id,'下一条讨论','next-message');await until(()=>calls===2&&f.repository.list('bot_executions',{conversationId:conversation.id}).filter(execution=>execution.triggerMessageId).length===2&&f.repository.list('bot_executions',{conversationId:conversation.id}).every(execution=>execution.status==='completed'||execution.status==='failed'));
  assert.equal(f.repository.list('bot_messages',{conversationId:conversation.id}).find(item=>item.idempotencyKey==='next-message').deliveryStatus,'delivered');assert.equal(f.service.detail(bot.id,conversation.id).conversation.status,'open');f.db.close();
});

test('budget preflight keeps the original message unsent and explicitly retries it without duplication',async()=>{
  let calls=0,message;const f=fixture(async(input,content,onRef)=>{
    calls++;
    if(calls===1)throw new DomainError('BOT_INPUT_TOO_LARGE','本次协作输入超过预算，未截断或调用模型',422,true);
    const marker=input.triggerMessageId;
    assert.equal(input.inputMode,'append');assert.equal(marker,message.id);assert.ok(content.includes('请继续处理原始请求'));
    onRef({kind:'pi',sessionFile:`/tmp/${input.identity}.jsonl`,sessionId:input.identity,cwd:input.cwd});
    return{startId:'start',endId:'end',evidence:[],result:{summary:'原输入已处理',verification:'not_run',checks:[],outputs:[],blockers:[]},messageEntryIds:{[message.id]:'native-input'}};
  });
  const bot=await f.service.create({name:'预算恢复'}),conversation=f.service.createConversation(bot.id,{});
  message=f.service.send(bot.id,conversation.id,'请继续处理原始请求','budget-original');
  await until(()=>f.repository.list('bot_executions',{triggerMessageId:message.id}).some(execution=>execution.status==='failed'));
  const first=f.repository.list('bot_executions',{triggerMessageId:message.id})[0],before=f.service.detail(bot.id,conversation.id);
  assert.equal(first.errorCode,'BOT_INPUT_TOO_LARGE');assert.equal(first.nativeStartEntryId,null);assert.equal(first.inputNativeEntryId,null);
  assert.equal(f.repository.get('bot_messages',message.id).deliveryStatus,'pending');assert.ok(before.canRetryPreflightMessageIds.includes(message.id));
  assert.equal(before.messages.filter(item=>item.idempotencyKey==='budget-original').length,1);assert.equal(before.busy,false);
  const retry=f.service.retryPreflightMessage(bot.id,conversation.id,message.id);
  assert.equal(retry.triggerMessageId,message.id);assert.equal(retry.inputMode,'append');
  await until(()=>f.repository.get('bot_executions',retry.id).status==='completed');
  const after=f.service.detail(bot.id,conversation.id);
  assert.equal(calls,2);assert.equal(f.repository.list('bot_messages',{conversationId:conversation.id}).filter(item=>item.idempotencyKey==='budget-original').length,1);
  assert.equal(f.repository.get('bot_messages',message.id).deliveryStatus,'delivered');assert.equal(f.repository.get('bot_messages',message.id).targetNativeEntryId,'native-input');
  assert.deepEqual(f.repository.list('bot_executions',{triggerMessageId:message.id}).map(execution=>execution.status),['failed','completed']);assert.deepEqual(after.canRetryPreflightMessageIds,[]);f.db.close();
});

test('unknown coordinator execution leaves later user input saved and the conversation open',async()=>{
  let calls=0;const f=fixture(async(input,content,onRef)=>{calls++;onRef({kind:'pi',sessionFile:`/tmp/${input.identity}.jsonl`,sessionId:input.identity,cwd:input.cwd});if(calls===1)throw new DomainError('EXECUTION_UNCERTAIN','执行结果未知',409,true);return{startId:'start',endId:'end',evidence:[],result:{summary:'后续输入已处理',verification:'not_run',checks:[],outputs:[],blockers:[]},messageEntryIds:{}};});
  const bot=await f.service.create({name:'未知执行'}),conversation=f.service.createConversation(bot.id,{}),first=f.service.send(bot.id,conversation.id,'第一条','uncertain');
  await until(()=>f.repository.list('bot_executions',{conversationId:conversation.id}).some(execution=>execution.status==='unknown'));
  assert.equal(f.repository.get('bot_messages',first.id).deliveryStatus,'unknown');f.service.send(bot.id,conversation.id,'后续讨论','following');
  const detail=f.service.detail(bot.id,conversation.id);assert.equal(detail.conversation.status,'open');assert.equal(detail.messages.find(message=>message.idempotencyKey==='following').deliveryStatus,'pending');assert.equal(detail.executions.filter(execution=>execution.status==='unknown').length,1);assert.equal(detail.displayPhase,'needs_attention');assert.equal(detail.canAcceptUserMessage,false);assert.equal(detail.canRunCoordinator,false);assert.ok(!detail.allowedActions.some(action=>action.action==='send_user_message'));f.db.close();
});

test('Bot coordination stays locked through child work and result follow-up, while child chat remains parent-bound',async()=>{
  let projectStartedResolve,releaseProjectResolve,followupStartedResolve,releaseFollowupResolve,targetSessionId=null;
  const projectStarted=new Promise(resolve=>projectStartedResolve=resolve),projectHold=new Promise(resolve=>releaseProjectResolve=resolve),
    followupStarted=new Promise(resolve=>followupStartedResolve=resolve),followupHold=new Promise(resolve=>releaseFollowupResolve=resolve);
  const f=fixture(async(input,content,onRef)=>{
    const execution=f.repository.get('bot_executions',input.executionId),task=execution.taskId?f.repository.get('bot_tasks',execution.taskId):null,
      trigger=execution.triggerMessageId?f.repository.get('bot_messages',execution.triggerMessageId):null,
      messageEntryIds=messageEntries(input,content);
    onRef({kind:'pi',sessionFile:`/tmp/${input.identity}.jsonl`,sessionId:input.identity,cwd:input.cwd});
    if(input.projectSessionId&&task){projectStartedResolve(execution);await projectHold;return{startId:'project-start',endId:'project-end',evidence:[{id:`evidence:${execution.id}`,kind:'assistant',text:'已检查目标文件',failed:false}],result:evidenceResult(execution.id,task),messageEntryIds};}
    if(input.projectSessionId)return{startId:'child-chat-start',endId:'child-chat-end',evidence:[{id:`evidence:${execution.id}`,kind:'assistant',text:'已继续项目会话',failed:false}],result:{summary:'已继续项目会话',verification:'not_run',checks:[],outputs:[],blockers:[]},messageEntryIds};
    if(trigger?.kind==='result'&&trigger.workId){followupStartedResolve(execution);await followupHold;return{startId:'followup-start',endId:'followup-end',evidence:[],result:{summary:'项目结果已汇总',verification:'not_run',checks:[],outputs:[],blockers:[],workOutcome:'completed'},messageEntryIds};}
    if(trigger?.kind==='result')throw Object.assign(new DomainError('EXECUTION_UNCERTAIN','协调续办结果未知',409,true),{messageEntryIds,nativeStartEntryId:'child-followup-start'});
    const work=await input.tools.find(tool=>tool.name==='bot_start_work').execute({title:'检查入口',goal:'在项目中检查入口文件'}),receipt=await input.tools.find(tool=>tool.name==='bot_create_task').execute({workId:work.id,sessionMode:'new',sessionId:null,projectId:'p',agentId:'project-agent',topic:'入口检查',creationReason:'需要项目执行上下文',title:'核对入口',instruction:'检查入口文件并报告结论',acceptanceCriteria:['入口结论已核实'],operation:'read',dependsOn:[]});
    targetSessionId=receipt.targetSessionId;
    return{startId:'dispatch-start',endId:'dispatch-end',evidence:[],result:{summary:'项目任务已排队',verification:'not_run',checks:[],outputs:[],blockers:[]},messageEntryIds};
  });
  const bot=await f.service.create({name:'协调轮次'}),conversation=f.service.createConversation(bot.id,{});
  f.service.send(bot.id,conversation.id,'请检查项目入口','round-origin');
  await projectStarted;
  let detail=f.service.detail(bot.id,conversation.id),initialMessageCount=f.repository.list('bot_messages',{conversationId:conversation.id}).length;
  assert.equal(detail.coordinationPending,true);assert.equal(detail.canAcceptUserMessage,false);
  assert.throws(()=>f.service.send(bot.id,conversation.id,'补充一个想法','blocked-during-child'),error=>error.code==='COORDINATION_PENDING');
  assert.equal(f.repository.list('bot_messages',{conversationId:conversation.id}).length,initialMessageCount);
  releaseProjectResolve();
  await followupStarted;
  detail=f.service.detail(bot.id,conversation.id);
  assert.equal(detail.messages.some(message=>message.kind==='result'&&message.deliveryStatus==='delivering'),true);
  assert.equal(detail.coordinationPending,true);assert.equal(detail.canAcceptUserMessage,false);
  assert.throws(()=>f.service.send(bot.id,conversation.id,'再补一个想法','blocked-during-followup'),error=>error.code==='COORDINATION_PENDING');
  releaseFollowupResolve();
  await until(()=>{const current=f.service.detail(bot.id,conversation.id);return current.works.some(work=>work.status==='completed')&&!current.coordinationPending;});
  detail=f.service.detail(bot.id,conversation.id);assert.equal(detail.canAcceptUserMessage,true);assert.equal(detail.messages.some(message=>message.kind==='result'&&message.deliveryStatus==='delivered'),true);
  const childMessage=f.service.send(bot.id,conversation.id,'在这个项目会话继续讨论','child-chat',targetSessionId);
  assert.equal(childMessage.targetSessionId,targetSessionId);assert.equal(childMessage.conversationId,conversation.id);
  await until(()=>f.repository.get('bot_messages',childMessage.id).deliveryStatus==='delivered');
  const childExecution=f.repository.list('bot_executions',{conversationId:conversation.id,triggerMessageId:childMessage.id})[0];
  assert.equal(childExecution.targetSessionId,targetSessionId);assert.equal(childExecution.kind,'interaction');
  await until(()=>f.repository.list('bot_executions',{conversationId:conversation.id}).some(execution=>execution.status==='unknown'&&execution.triggerMessageId&&f.repository.get('bot_messages',execution.triggerMessageId)?.kind==='result'));
  const uncertainFollowup=f.repository.list('bot_executions',{conversationId:conversation.id}).find(execution=>execution.status==='unknown'&&execution.triggerMessageId&&f.repository.get('bot_messages',execution.triggerMessageId)?.kind==='result');
  assert.equal(f.repository.get('bot_messages',uncertainFollowup.triggerMessageId).deliveryStatus,'delivered');
  detail=f.service.detail(bot.id,conversation.id);assert.equal(detail.coordinationPending,true);assert.equal(detail.canAcceptUserMessage,false);
  assert.throws(()=>f.service.send(bot.id,conversation.id,'先等一下','blocked-during-unknown-followup'),error=>error.code==='COORDINATION_PENDING');
  f.runtime.resolve=async()=>({endId:'resolved-end',evidence:[],result:{summary:'项目会话回复已收到',verification:'not_run',checks:[],outputs:[],blockers:[]},messageEntryIds:{}});
  await f.service.resolve(bot.id,conversation.id,uncertainFollowup.id);
  assert.equal(f.service.detail(bot.id,conversation.id).coordinationPending,false);assert.equal(f.service.detail(bot.id,conversation.id).canAcceptUserMessage,true);
  f.db.close();
});

test('retrying a delivered input uses resume_received without appending its original text again',async()=>{
  const {DomainError}=require('../src/domain/errors.ts');let calls=0,messageId='';
  const f=fixture(async(input,content,onRef)=>{calls++;onRef({kind:'pi',sessionFile:`/tmp/${input.identity}.jsonl`,sessionId:input.identity,cwd:input.cwd});if(calls===1){messageId=input.triggerMessageId;throw Object.assign(new DomainError('BOT_MODEL_UNAVAILABLE','模型不可用',503,true),{messageEntryIds:{[messageId]:'native-input-entry'},nativeStartEntryId:'failed-start'});}assert.equal(input.inputMode,'resume_received');assert.equal(input.resumedFromExecutionId!==null,true);assert.equal(input.inputNativeEntryId,'native-input-entry');assert.ok(!content.includes(`[BOT_MESSAGE:${messageId}]`));assert.ok(!content.includes('第一次请求原文'));return{startId:'resume-start',endId:'resume-end',evidence:[],result:{summary:'继续处理完成',verification:'not_run',checks:[],outputs:[],blockers:[]},messageEntryIds:{}};});
  const bot=await f.service.create({name:'续答'}),conversation=f.service.createConversation(bot.id,{}),message=f.service.send(bot.id,conversation.id,'第一次请求原文','resume-source');
  await until(()=>f.repository.list('bot_executions',{conversationId:conversation.id}).some(execution=>execution.status==='failed'));
  const before=f.service.detail(bot.id,conversation.id);assert.ok(before.canResumeReceivedMessageIds.includes(message.id));
  const resumed=f.service.retryReceivedMessage(bot.id,conversation.id,message.id,'resume-action');assert.equal(resumed.inputMode,'resume_received');assert.equal(resumed.resumedFromExecutionId,f.repository.list('bot_executions',{triggerMessageId:message.id})[0].id);
  await until(()=>f.repository.get('bot_executions',resumed.id).status==='completed');
  assert.equal(f.repository.get('bot_messages',message.id).deliveryStatus,'delivered');assert.equal(f.repository.get('bot_messages',message.id).targetNativeEntryId,'native-input-entry');assert.equal(f.repository.list('bot_executions',{triggerMessageId:message.id}).length,2);f.db.close();
});

test('删除协调会话直接删除空闲总对话及其关联项目会话',()=>{
  const {DomainError}=require('../src/domain/errors.ts');
  const f=fixture(async()=>({startId:'start',endId:'end',evidence:[],result:{summary:'未调用',verification:'not_run',checks:[],outputs:[],blockers:[]},messageEntryIds:{}}));
  return f.service.create({name:'删除'}).then(bot=>{
    const conversation=f.service.createConversation(bot.id,{title:'待删除'}),
      session=f.service.attach(bot.id,conversation.id,{projectId:'p',agentId:'project-agent'}),
      memoryId=session.sessionMemoryId;
    f.service.updateConversation(bot.id,conversation.id,{status:'deleted'},conversation.writeETag);
    assert.equal(f.repository.get('bot_conversations',conversation.id),null);
    assert.equal(f.sessions.get(session.id),null);assert.equal(f.db.prepare('SELECT id FROM session_memories WHERE id=?').get(memoryId),undefined);
    assert.equal(f.db.prepare('SELECT bot_conversation_id FROM bot_conversation_projects WHERE bot_conversation_id=?').get(conversation.id),undefined);
    assert.throws(()=>f.service.send(bot.id,conversation.id,'删除后不能继续','after-delete'),error=>error instanceof DomainError&&error.code==='NOT_FOUND');
    const busy=f.service.createConversation(bot.id,{title:'忙碌'});
    const now=new Date().toISOString();
    f.repository.insert('bot_messages',{id:'busy-message',conversationId:busy.id,workId:null,taskId:null,sourceKind:'user',sourceSessionId:null,sourceExecutionId:null,targetSessionId:null,replyToMessageId:null,kind:'message',content:'仍在处理',deliveryMode:'when_idle',deliveryStatus:'pending',deliveryStartedAt:null,deliveryRuntimeInstanceId:null,withdrawRequestedAt:null,targetNativeEntryId:null,idempotencyKey:'busy-message',createdAt:now,updatedAt:now,deliveredAt:null});
    f.repository.insert('bot_works',{id:'busy-work',conversationId:busy.id,originMessageId:'busy-message',title:'未结束',goal:'验证必填来源',status:'open',finalExecutionId:null,idempotencyKey:'busy-work',createdAt:now,updatedAt:now,finishedAt:null});
    f.service.updateConversation(bot.id,busy.id,{status:'deleted'},busy.writeETag);
    assert.equal(f.repository.get('bot_conversations',busy.id),null);assert.equal(f.repository.get('bot_messages','busy-message'),null);
    f.db.close();
  });
});
