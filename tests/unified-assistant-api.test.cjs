require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {fixture}=require('./workspace-fixture.cjs');
const {createAgentRepository}=require('../src/infrastructure/database/agent-repository.ts');
const {createProjectRepository}=require('../src/infrastructure/database/project-repository.ts');
const {createSessionRepository}=require('../src/infrastructure/database/session-repository.ts');
const {createCatalogService}=require('../src/application/catalog-service.ts');
const {createSessionAssistantStore}=require('../src/infrastructure/agents/session-assistant-store.server.ts');
const {createSessionAssistantAccess}=require('../src/application/session-assistant-service.ts');
const {createSessionExecutionService}=require('../src/application/session-execution-service.ts');
const {createWorkspaceService}=require('../src/application/workspace-service.ts');
const {workspaceDirectories}=require('../src/infrastructure/workspaces/directories.server.ts');
const {createProjectRulesStore}=require('../src/infrastructure/agents/project-rules-store.server.ts');
const {createProjectRulesService}=require('../src/application/project-rules-service.ts');
const {createProjectRuleGenerationsStore}=require('../src/infrastructure/agents/project-rule-generations.server.ts');
const {createProjectRulesApi}=require('../src/shared/protocol/project-rules-api.server.ts');
const {createAgentPreparationService}=require('../src/application/agent-service.ts');
const {createUnifiedAssistantService}=require('../src/application/unified-assistant-service.ts');
const {createGenerationSkills}=require('../src/infrastructure/agents/generation-skills.server.ts');
const {roleETag}=require('../src/domain/agent-definition.ts');
const unified=(source,systemPrompt='')=>({format:4,scope:source?.kind??'global',source,systemPromptMode:systemPrompt?'replace':'inherit',systemPrompt});
function setup(runtime){const f=fixture(),old=process.env.AI_WORKSPACE_AGENT_DIR;process.env.AI_WORKSPACE_AGENT_DIR=path.join(f.root,'agents');const agents=createAgentRepository(f.db),projects=createProjectRepository(f.db),sessions=createSessionRepository(f.db),rules=createProjectRulesStore(path.join(f.root,'rules'));
 const catalog=createCatalogService({agents,projects,mcps:{},normalizeProjectRoot:p=>p,resolveAssistantSource:source=>{const {DomainError}=require('../src/domain/errors.ts');const w=f.repository.get(source.workspaceId);if(!w)throw new DomainError('NOT_FOUND','工作区不存在',404,true);return (source.projectIds??w.projects.map(p=>p.id)).map(id=>{const p=w.projects.find(p=>p.id===id);if(!p)throw new DomainError('REFERENCE_OUTSIDE_SCOPE','项目不属于所选工作区',403,true);return p;});}}),assistants=createSessionAssistantAccess(createSessionAssistantStore(path.join(f.root,'selections')),(id,r,h)=>agents.getVersion(id,r,h));
 return {...f,agents,projects,sessions,rules,catalog,assistants,execution:createSessionExecutionService({sessions,projects,catalog,assistants,runtime:runtime??f.runtime,projectRules:rules}),workspace:createWorkspaceService({repository:f.repository,assistants,runtime:runtime??f.runtime,directories:workspaceDirectories,projectRules:rules,findProject:id=>projects.get(id)}),agent:definition=>catalog.createAgent({name:'Assistant',kind:'project',definition}),cleanup(){f.finish();f.close();if(old===undefined)delete process.env.AI_WORKSPACE_AGENT_DIR;else process.env.AI_WORKSPACE_AGENT_DIR=old;}};
}

test('catalog API persists unified assistants without AGENTS.md and keeps exact old versions',()=>{const f=setup();try{
 const definition=unified({kind:'workspace',workspaceId:'w',projectIds:null});const a=f.agent(definition),dir=path.join(process.env.AI_WORKSPACE_AGENT_DIR,a.id,'1');assert.deepEqual(fs.readdirSync(dir),['definition.json']);assert.deepEqual(f.agents.getVersion(a.id,1,a.contentSha256).definition,definition);
 const b=f.catalog.updateAgent(a.id,{definition:{...definition,source:{...definition.source,projectIds:['p','q']},systemPromptMode:'replace',systemPrompt:'Full replacement'},writeETag:roleETag(a)});assert.equal(b.revision,2);assert.equal(f.agents.getVersion(a.id,1,a.contentSha256).definition.systemPromptMode,'inherit');
 for(const d of [{...definition,projects:[]},{...definition,source:{...definition.source,projectIds:[]}},{...definition,systemPrompt:'invalid inheritance'},{...definition,systemPromptMode:'replace',systemPrompt:''}])assert.throws(()=>f.agent(d),e=>e.code==='INVALID_ROLE');
 const legacy=f.agents.create({name:'Old',description:null,kind:'project',projectId:null,sourceTemplateId:null,status:'active',definition:{format:3,mode:'custom',scope:'project',source:null,systemPrompt:'Old exact',projects:[]}});const bytes=fs.readFileSync(path.join(process.env.AI_WORKSPACE_AGENT_DIR,legacy.id,'1','AGENTS.md'));f.catalog.updateAgent(legacy.id,{definition:unified({kind:'project',projectId:'p'},'New'),writeETag:roleETag(legacy)});assert.deepEqual(fs.readFileSync(path.join(process.env.AI_WORKSPACE_AGENT_DIR,legacy.id,'1','AGENTS.md')),bytes);
 }finally{f.cleanup();}});

test('unified preparation API polishes system prompt without collecting project files or changing scope',async()=>{
 let input;const old=createAgentPreparationService({skills:createGenerationSkills(),resolveSource:()=>{throw Error('must not read project');},generate:async value=>{input=JSON.parse(value);return JSON.stringify({text:'Polished replacement'});}});
 const service=createUnifiedAssistantService(old,()=>{}),definition=unified({kind:'workspace',workspaceId:'w',projectIds:['p','q']});
 const result=await service.prepare({mode:'generate',currentDraft:definition,inputText:'Please polish'},new AbortController().signal);assert.equal(input.skill,null);assert.deepEqual(input.projects,[]);assert.equal(result.definition.systemPrompt,'Polished replacement');assert.deepEqual(result.definition.source,definition.source);assert.equal(result.definition.systemPromptMode,'replace');
 await assert.rejects(service.prepare({mode:'generate',source:definition.source,target:'projects'},new AbortController().signal),e=>e.code==='INVALID_INPUT');
});

test('unbound assistant APIs save, revise and prepare without a project source',async()=>{const f=setup();try{
 const a=f.agent(unified(null));assert.equal(a.definition.scope,'global');assert.equal(a.definition.source,null);assert.equal(f.agents.getVersion(a.id,1,a.contentSha256).definition.source,null);
 const b=f.catalog.updateAgent(a.id,{definition:unified(null,'Universal instructions'),writeETag:roleETag(a)});assert.equal(b.definition.systemPrompt,'Universal instructions');assert.equal(f.agents.getVersion(a.id,1,a.contentSha256).definition.systemPromptMode,'inherit');
 for(const definition of [{...unified(null),source:{kind:'project',projectId:'x'}},{...unified(null),scope:'project'},{...unified(null),scope:'workspace'},{...unified(null),source:undefined}])assert.throws(()=>f.agent(definition),e=>e.code==='INVALID_ROLE');
 const legacy=createAgentPreparationService({skills:createGenerationSkills(),resolveSource:()=>{throw Error('must not resolve project');},generate:async()=>JSON.stringify({text:'Polished global prompt'})});
 const service=createUnifiedAssistantService(legacy,()=>{throw Error('must not resolve source');});const prepared=await service.prepare({mode:'generate',currentDraft:unified(null),inputText:'Please polish'},new AbortController().signal);assert.deepEqual(prepared.definition,unified(null,'Polished global prompt'));
 }finally{f.cleanup();}});

test('reference candidate API orders project assistants before unbound and rejects outside membership',async()=>{const f=setup();try{
 const w=await f.workspace.save(null,{name:'References',projects:[{rootPath:f.a},{rootPath:f.b}],defaultProjectIndex:0},'reference-w');
 const project=f.projects.create({name:'Project',description:null,kind:'code',rootPath:fs.realpathSync(f.a),status:'active'});
 const other=f.projects.create({name:'Other',description:null,kind:'code',rootPath:fs.realpathSync(f.b),status:'active'});
 const global=f.agent(unified(null,'Global')),local=f.agent(unified({kind:'project',projectId:project.id},'Local')),outside=f.agent(unified({kind:'project',projectId:other.id},'Outside'));
 const member=f.agent(unified({kind:'workspace',workspaceId:w.id,projectIds:[w.projects[0].id]},'Member')),all=f.agent(unified({kind:'workspace',workspaceId:w.id,projectIds:null},'All'));
 const notMember=f.agent(unified({kind:'workspace',workspaceId:w.id,projectIds:[w.projects[1].id]},'Not member')),otherWorkspace=f.agent(unified({kind:'workspace',workspaceId:'elsewhere',projectIds:null},'Elsewhere'));
 const disabled=f.agent(unified(null,'Disabled'));f.catalog.updateAgent(disabled.id,{status:'disabled',writeETag:roleETag(disabled)});
 const legacy=f.agents.create({name:'Legacy',description:null,kind:'project',projectId:null,sourceTemplateId:null,status:'active',definition:{format:3,mode:'custom',scope:'project',source:null,systemPrompt:'Legacy',projects:[]}});
 const candidates=f.catalog.listReferenceAgents({projectId:project.id});assert.deepEqual(new Set(candidates.map(a=>a.id)),new Set([local.id,global.id,legacy.id]));assert.equal(candidates[0].id,local.id);
 const workspace=f.catalog.listReferenceAgents({workspaceId:w.id,projectId:w.projects[0].id});assert.deepEqual(new Set(workspace.map(a=>a.id)),new Set([local.id,member.id,all.id,global.id,legacy.id]));assert(workspace.findIndex(a=>a.id===global.id)>=3);assert(workspace.findIndex(a=>a.id===legacy.id)>=3);
 assert.deepEqual(new Set(f.catalog.listReferenceAgents({}).map(a=>a.id)),new Set([global.id,legacy.id]));assert(f.catalog.listAgents().some(a=>a.id===outside.id));assert(f.catalog.listAgents().some(a=>a.id===notMember.id));assert(f.catalog.listAgents().some(a=>a.id===otherWorkspace.id));
 assert.throws(()=>f.catalog.listReferenceAgents({projectId:'missing'}),e=>e.code==='NOT_FOUND');assert.throws(()=>f.catalog.listReferenceAgents({workspaceId:w.id,projectId:project.id}),e=>e.code==='REFERENCE_OUTSIDE_SCOPE');assert.throws(()=>f.catalog.listReferenceAgents({projectId:''}),e=>e.code==='INVALID_INPUT');assert.throws(()=>f.catalog.listReferenceAgents({unexpected:true}),e=>e.code==='INVALID_INPUT');
 }finally{f.cleanup();}});

test('project rules APIs enforce membership, ETag, immutable revisions, enable switches and generation failure',async()=>{const f=setup();try{
 const id={scope:'project',projectId:'p'},requests=[];let fail=false;
 const prepare=createAgentPreparationService({skills:createGenerationSkills(),resolveSource:()=>[{id:'p',name:'P',rootPath:f.a}],generate:async(_input,_signal,_mode,context)=>{requests.push(context.cwd);context.onRead('read');if(fail)throw new (require('../src/domain/errors.ts').DomainError)('ROLE_GENERATION_FAILED','controlled failure',503,true);return JSON.stringify({rules:[{id:'p',rules:'# Real project rules'}]});}});
 const service=createProjectRulesService({store:f.rules,generations:createProjectRuleGenerationsStore(path.join(f.root,'rules')),resolve:identity=>{if(identity.projectId!=='p')throw new (require('../src/domain/errors.ts').DomainError)('NOT_FOUND','missing',404,true);return {id:'p',name:'P',rootPath:f.a};},prepare}),route=createProjectRulesApi(service);
 let key=0;const call=(method,body,etag,identity=id,stream=false)=>route(new Request('http://localhost/rules',{method,headers:{'content-type':'application/json','idempotency-key':'test-'+(++key),...(etag?{'if-match':etag}:{}),...(stream?{accept:'application/x-ndjson'}:{})},...(body?{body:JSON.stringify(body)}:{})}),identity);
 const initial=(await (await call('GET')).json()).data;assert.equal(initial.enabled,false);assert.equal(initial.revision,0);
 assert.equal((await call('PUT',{enabled:true},initial.writeETag)).status,400);assert.equal((await call('POST',{})).status,428);
 const generated=await call('POST',{},initial.writeETag);assert.equal(generated.status,202);assert.equal((await generated.json()).data.generation.status,'queued');await new Promise(setImmediate);let current=(await (await call('GET')).json()).data;assert.equal(current.generation.status,'succeeded');assert.equal(current.revision,1);assert.equal(current.enabled,false);assert.deepEqual(requests,[f.a]);
 const enabled=(await (await call('PUT',{enabled:true},current.writeETag)).json()).data;assert.equal(enabled.enabled,true);assert.equal((await call('PUT',{enabled:false},current.writeETag)).status,409);
 fail=true;const oldRead=f.rules.read(id);const failed=await call('POST',{},enabled.writeETag);assert.equal(failed.status,202);await new Promise(setImmediate);assert.equal(service.read(id).generation.status,'failed');assert.deepEqual(f.rules.read(id),oldRead);fail=false;
 await call('POST',{},enabled.writeETag);await new Promise(setImmediate);current=service.read(id);assert.equal(current.revision,2);assert.equal(current.enabled,true);assert.equal((await call('GET',null,null,{scope:'workspace',workspaceId:'w',projectId:'outside'})).status,404);
 const workspaceIdentity={scope:'workspace',workspaceId:'w',projectId:'p'};assert.equal(f.rules.read(workspaceIdentity).revision,0);f.rules.write(workspaceIdentity,f.rules.read(workspaceIdentity).writeETag,{markdown:'Separate member rules'});assert.equal(f.rules.read(id).markdown,'# Real project rules');
 }finally{f.cleanup();}});

test('project rule generation rejects concurrent state changes and cancelled results',async()=>{
 const f=setup();try{
  const id={scope:'project',projectId:'p'};let release,started;
  const prepare={prepare:async()=>{started();return new Promise(resolve=>release=()=>resolve({definition:{projects:[{id:'p',rules:'stale generation'}]}}));}};
  const service=createProjectRulesService({store:f.rules,generations:createProjectRuleGenerationsStore(path.join(f.root,'rules')),resolve:()=>({id:'p',name:'P',rootPath:f.a}),prepare});
  const initial=f.rules.write(id,f.rules.read(id).writeETag,{markdown:'original'});
  let began=new Promise(r=>started=r);let result=service.generate(id,{},initial.writeETag,new AbortController().signal);await began;
  const enabled=service.update(id,{enabled:true},initial.writeETag);release();await assert.rejects(result,e=>e.code==='WRITE_CONFLICT');assert.deepEqual(service.read(id),enabled);
  const cancel=new AbortController();began=new Promise(r=>started=r);result=service.generate(id,{},enabled.writeETag,cancel.signal);await began;cancel.abort();release();await assert.rejects(result,e=>e.code==='REQUEST_ABORTED');assert.deepEqual(service.read(id),enabled);
 }finally{f.cleanup();}
});

test('session APIs use scoped project rules only with assistants and reuse prompt configuration across turns',async()=>{
 const pi=await import('@earendil-works/pi-coding-agent'),ai=await import('@earendil-works/pi-ai');const original=Module._load;let PiSessionRuntime,initializeSession;
 Module._load=function(name,...args){return name==='@earendil-works/pi-coding-agent'?pi:name==='@earendil-works/pi-ai'?ai:original.call(this,name,...args);};try{({PiSessionRuntime}=require('../src/infrastructure/pi/pi-session-runtime.server.ts'));({initializeSession}=require('./support/initialize-pi-session.ts'));}finally{Module._load=original;}
 const modelRuntime=await pi.ModelRuntime.create({credentials:{async read(){},async list(){return [];},async modify(){},async delete(){}},modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});modelRuntime.registerProvider('fake',{name:'fake',baseUrl:'http://localhost',apiKey:'fake',api:'openai-completions',models:[{id:'fake',name:'fake',api:'openai-completions',baseUrl:'http://localhost',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:0},contextWindow:128000,maxTokens:1000}]});
 const runtime=new PiSessionRuntime(async()=>({runtime:modelRuntime,model:modelRuntime.getModel('fake','fake')})),f=setup(runtime);
 try{
 const w=await f.workspace.save(null,{name:'Scope',projects:[{rootPath:f.a},{rootPath:f.b}],defaultProjectIndex:0},'create-w');const ws=f.workspace.createSession(w.id,{},'create-s');const manager=initializeSession('unified-scope',w.projects[0].rootPath,f.root);f.repository.bindNative(w.id,ws.id,{kind:'pi',sessionId:manager.getSessionId(),sessionFile:manager.getSessionFile(),cwd:w.projects[0].rootPath});let lease=await f.workspace.open(w.id,ws.id);
 for(const p of w.projects){const id={scope:'workspace',workspaceId:w.id,projectId:p.id};const v=f.rules.write(id,f.rules.read(id).writeETag,{markdown:'RULE_'+p.id});f.rules.write(id,v.writeETag,{enabled:true});}
 let capture;const prompts=[];const h=runtime.getHandle(ws.id);h.session.agent.streamFunction=(_m,c)=>{prompts.push(ai.getCurrentSystemPrompt(c.messages));const stream=ai.createAssistantMessageEventStream();stream.push({type:'done',reason:'stop',message:{role:'assistant',content:[{type:'text',text:'ok'}],api:'openai-completions',provider:'fake',model:'fake',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()}});stream.end();queueMicrotask(()=>capture?.());return stream;};
 let seq=0;async function send(){let done;const end=new Promise(r=>done=r);const unsubscribe=h.session.subscribe(e=>{if(e.type==='agent_end')done();});try{await f.workspace.accept(w.id,ws.id,{content:'message '+(++seq)},'send-'+seq,lease.leaseId);await end;await new Promise(r=>setImmediate(r));}finally{unsubscribe();}}
 async function select(agent){await f.workspace.changeAssistant(w.id,ws.id,{selection:agent?{agentId:agent.id,revision:agent.revision,contentSha256:agent.contentSha256}:null},f.workspace.assistant(w.id,ws.id).writeETag,lease.leaseId);}
 await send();assert(prompts.at(-1).includes(w.projects[0].id));assert(prompts.at(-1).includes(w.projects[1].id));assert(!prompts.at(-1).includes('RULE_'));
 const a=f.agent(unified({kind:'workspace',workspaceId:w.id,projectIds:[w.projects[1].id]},'CUSTOM SYSTEM'));await select(a);await send();assert.equal(runtime.getHandle(ws.id),h);assert(prompts.at(-1).includes('CUSTOM SYSTEM'));assert(!prompts.at(-1).includes('<project id="'+w.projects[0].id+'"'));assert(prompts.at(-1).includes('RULE_'+w.projects[1].id));
 const systems=h.session.messages.filter(m=>m.role==='system').length;await send();assert.equal(h.session.messages.filter(m=>m.role==='system').length,systems);assert.equal(prompts.at(-1),prompts.at(-2));
 const id={scope:'workspace',workspaceId:w.id,projectId:w.projects[1].id};f.rules.write(id,f.rules.read(id).writeETag,{enabled:false});await send();assert(!prompts.at(-1).includes('RULE_'));assert.equal(runtime.getHandle(ws.id),h);
 const all=f.agent(unified({kind:'workspace',workspaceId:w.id,projectIds:null}));await select(all);await send();assert(prompts.at(-1).includes('You are a coding assistant'));assert(prompts.at(-1).includes('<project id="'+w.projects[0].id+'"'));assert(prompts.at(-1).includes('<project id="'+w.projects[1].id+'"'));
 const unbound=f.agent(unified(null,'UNBOUND PROMPT'));await select(unbound);await send();assert(prompts.at(-1).includes('UNBOUND PROMPT'));assert(!prompts.at(-1).includes('RULE_'));assert(prompts.at(-1).includes('<project id="'+w.projects[0].id+'"'));assert(prompts.at(-1).includes('<project id="'+w.projects[1].id+'"'));const unboundSystems=h.session.messages.filter(m=>m.role==='system').length;await send();assert.equal(h.session.messages.filter(m=>m.role==='system').length,unboundSystems);
 await select(null);await send();assert(!prompts.at(-1).includes('RULE_'));assert(!prompts.at(-1).includes('CUSTOM SYSTEM'));const streamFunction=h.session.agent.streamFunction;await f.workspace.deleteSession(w.id,ws.id);
 const project=f.projects.create({name:'Solo',description:null,kind:'code',rootPath:fs.realpathSync(f.a),status:'active'}),ps=f.sessions.create({projectId:project.id,purpose:'',agentId:null,agentSnapshot:null,mcpIds:[],mcpSnapshots:[]});
 const pm=initializeSession('solo-unified',project.rootPath,f.root);f.sessions.setNativeRefIfAbsent(ps.id,{kind:'pi',sessionId:pm.getSessionId(),sessionFile:pm.getSessionFile(),cwd:project.rootPath});const pl=await f.execution.open(ps.id,'open-solo'),ph=runtime.getHandle(ps.id);ph.session.agent.streamFunction=streamFunction;
 const pid={scope:'project',projectId:project.id};const pv=f.rules.write(pid,f.rules.read(pid).writeETag,{markdown:'SOLO RULE'});f.rules.write(pid,pv.writeETag,{enabled:true});
 const soloSend=async()=>{for await(const event of f.execution.send(ps.id,'solo message'))assert.notEqual(event.type,'error');};
 await soloSend();assert(!prompts.at(-1).includes('SOLO RULE'));const solo=f.agent(unified({kind:'project',projectId:project.id}));f.execution.changeAssistant(ps.id,{selection:{agentId:solo.id,revision:solo.revision,contentSha256:solo.contentSha256}},f.execution.assistant(ps.id).writeETag,pl.leaseId);await soloSend();assert(prompts.at(-1).includes('SOLO RULE'));const soloSystems=ph.session.messages.filter(m=>m.role==='system').length;await soloSend();assert.equal(ph.session.messages.filter(m=>m.role==='system').length,soloSystems);assert.equal(runtime.getHandle(ps.id),ph);
 f.rules.write(pid,f.rules.read(pid).writeETag,{markdown:'UPDATED SOLO RULE'});await soloSend();assert(prompts.at(-1).includes('UPDATED SOLO RULE'));f.execution.changeAssistant(ps.id,{selection:{agentId:unbound.id,revision:unbound.revision,contentSha256:unbound.contentSha256}},f.execution.assistant(ps.id).writeETag,pl.leaseId);await soloSend();assert(prompts.at(-1).includes('UNBOUND PROMPT'));assert(!prompts.at(-1).includes('SOLO RULE'));assert.equal(runtime.getHandle(ps.id),ph);await f.execution.deleteSession(project.id,ps.id);
 }finally{f.cleanup();}
});
