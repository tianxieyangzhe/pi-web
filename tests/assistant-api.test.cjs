require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {fixture}=require('./workspace-fixture.cjs');
const {createCatalogService}=require('../src/application/catalog-service.ts');
const {createAgentRepository}=require('../src/infrastructure/database/agent-repository.ts');
const {createProjectRepository}=require('../src/infrastructure/database/project-repository.ts');
const {createSessionRepository}=require('../src/infrastructure/database/session-repository.ts');
const {createSessionExecutionService}=require('../src/application/session-execution-service.ts');
const {createWorkspaceService}=require('../src/application/workspace-service.ts');
const {workspaceDirectories}=require('../src/infrastructure/workspaces/directories.server.ts');
const {createWorkspaceApi}=require('../src/shared/protocol/workspace-api.server.ts');
const {createSessionAssistantStore}=require('../src/infrastructure/agents/session-assistant-store.server.ts');
const {createSessionAssistantAccess}=require('../src/application/session-assistant-service.ts');
const {createAgentPreparationService}=require('../src/application/agent-service.ts');
const {createGenerationSkills}=require('../src/infrastructure/agents/generation-skills.server.ts');
const generationSkills=createGenerationSkills();
const {roleETag}=require('../src/domain/agent-definition.ts');
const custom=(systemPrompt='  用户原文\r\n# 保留标题\n\n')=>({format:3,mode:'custom',scope:'project',systemPrompt,source:null,projects:[]});
function setup(runtime){
 const f=fixture(),old=process.env.AI_WORKSPACE_AGENT_DIR;process.env.AI_WORKSPACE_AGENT_DIR=path.join(f.root,'agents');
 const agents=createAgentRepository(f.db),projects=createProjectRepository(f.db),sessions=createSessionRepository(f.db),store=createSessionAssistantStore(path.join(f.root,'selections'));
 const assistants=createSessionAssistantAccess(store,(id,revision,hash)=>agents.getVersion(id,revision,hash));
 const catalog=createCatalogService({agents,projects,mcps:{},normalizeProjectRoot:p=>p,assistantInUse:id=>store.inUse(id)});
 const workspace=createWorkspaceService({repository:f.repository,runtime:runtime??f.runtime,directories:workspaceDirectories,assistants});
 const execution=createSessionExecutionService({sessions,projects,catalog,runtime:runtime??f.runtime,assistants});
 const agent=(definition=custom())=>catalog.createAgent({name:'助手',kind:'project',definition});
 return {...f,agents,projects,sessions,store,assistants,catalog,workspace,execution,agent,cleanup(){f.finish();f.close();if(old===undefined)delete process.env.AI_WORKSPACE_AGENT_DIR;else process.env.AI_WORKSPACE_AGENT_DIR=old;}};
}
test('catalog API saves exact custom AGENTS.md, preserves old versions and detects metadata/body damage',()=>{
 const f=setup();try{
  const a=f.agent(),folder=path.join(process.env.AI_WORKSPACE_AGENT_DIR,a.id,'1'),raw=fs.readFileSync(path.join(folder,'AGENTS.md'),'utf8');
  assert.equal(raw,custom().systemPrompt);assert(!raw.includes('base_prompt'));assert.equal(f.db.prepare('SELECT definition_json FROM agents WHERE id=?').get(a.id).definition_json,null);
  const b=f.catalog.updateAgent(a.id,{definition:custom('new system'),writeETag:roleETag(a)});assert.equal(b.revision,2);assert.equal(f.agents.getVersion(a.id,1,a.contentSha256).definition.systemPrompt,custom().systemPrompt);assert.equal(fs.readFileSync(path.join(folder,'AGENTS.md'),'utf8'),raw);
  assert.throws(()=>f.catalog.updateAgent(a.id,{name:'stale',writeETag:roleETag(a)}),e=>e.code==='WRITE_CONFLICT');
  const disabled=f.catalog.updateAgent(a.id,{status:'disabled',writeETag:roleETag(b)});assert.equal(disabled.revision,2);
  const legacy=f.agents.create({name:'旧助手',description:null,kind:'project',projectId:null,sourceTemplateId:null,status:'active',definition:{instructions:'old instructions',capabilities:{readFiles:false,writeFiles:false}}});const oldBytes=fs.readFileSync(path.join(process.env.AI_WORKSPACE_AGENT_DIR,legacy.id,'1.md'));
  f.catalog.updateAgent(legacy.id,{definition:custom('converted'),writeETag:roleETag(legacy)});assert.deepEqual(fs.readFileSync(path.join(process.env.AI_WORKSPACE_AGENT_DIR,legacy.id,'1.md')),oldBytes);
  fs.appendFileSync(path.join(folder,'AGENTS.md'),'changed');assert.throws(()=>f.agents.getVersion(a.id,1,a.contentSha256),e=>e.code==='ROLE_VERSION_MISSING');
 }finally{f.cleanup();}
});
test('catalog API writes agents directory and preserves exact historical versions through read-only fallback',()=>{
 const f=setup(),cwd=process.cwd();
 try{
  const historical=path.join(f.root,'.data','agents');process.env.AI_WORKSPACE_AGENT_DIR=historical;
  const old=f.agent(custom('historical primary'));
  const oldFile=path.join(historical,old.id,'1','AGENTS.md'),bytes=fs.readFileSync(oldFile);
  const legacy=f.agents.create({name:'legacy',description:null,kind:'project',projectId:null,sourceTemplateId:null,status:'active',definition:{instructions:'legacy body',capabilities:{readFiles:false,writeFiles:false}}});
  process.chdir(f.root);delete process.env.AI_WORKSPACE_AGENT_DIR;
  assert.equal(f.agents.getVersion(old.id,1,old.contentSha256).definition.systemPrompt,'historical primary');
  assert.equal(f.agents.getVersion(legacy.id,1,legacy.contentSha256).definition.instructions,'legacy body');
  const next=f.catalog.updateAgent(old.id,{definition:custom('new primary'),writeETag:roleETag(old)});
  assert.equal(fs.readFileSync(path.join(f.root,'agents',old.id,'2','AGENTS.md'),'utf8'),'new primary');assert.deepEqual(fs.readFileSync(oldFile),bytes);
  assert.equal(f.agents.getVersion(old.id,1,old.contentSha256).definition.systemPrompt,'historical primary');assert.equal(f.agents.getVersion(next.id,2,next.contentSha256).definition.systemPrompt,'new primary');
  const {writeAgentVersion}=require('../src/infrastructure/agents/agent-file-store.server.ts');
  assert.throws(()=>writeAgentVersion({agentId:old.id,revision:1,kind:'project',name:old.name,description:null,definition:custom('overwrite')}),e=>e.code==='WRITE_CONFLICT');
  const shadow=path.join(f.root,'agents',old.id,'1');fs.mkdirSync(shadow);fs.writeFileSync(path.join(shadow,'AGENTS.md'),'damaged');
  assert.throws(()=>f.agents.getVersion(old.id,1,old.contentSha256),e=>e.code==='ROLE_VERSION_MISSING');assert.deepEqual(fs.readFileSync(oldFile),bytes);
 }finally{process.chdir(cwd);f.cleanup();}
});
for(const scope of ['project','workspace'])test(`${scope} catalog API saves project rules only and preserves historical formats`,()=>{
 const f=setup();try{
  const first={id:'p',name:'P',rules:'  # Rules\r\nKeep <literal> &amp; unchanged.\n'},second={id:'q',name:'Q',rules:'\n# Other\nOnly Q.\n'};
  const definition={format:3,mode:'generated',scope,source:scope==='project'?{kind:'project',projectId:'p'}:{kind:'workspace',workspaceId:'w',projectIds:['p','q']},systemPrompt:'',projects:scope==='project'?[first]:[first,second]};
  const a=f.agent(definition),directory=path.join(process.env.AI_WORKSPACE_AGENT_DIR,a.id,'1');
  const metadata=JSON.parse(fs.readFileSync(path.join(directory,'definition.json'),'utf8'));
  assert.equal(fs.existsSync(path.join(directory,'AGENTS.md')),scope==='project');
  for(const [i,p] of definition.projects.entries()){const raw=fs.readFileSync(path.join(directory,metadata.projects[i].file.path),'utf8');assert.equal(raw,p.rules);assert(!raw.includes('<project '));assert(!raw.includes('<rules>'));}
  assert.equal(metadata.format,5);assert(!Object.hasOwn(metadata,'instructions'));assert.deepEqual(f.agents.getVersion(a.id,1,a.contentSha256).definition,definition);
  const legacy={...definition,format:2,instructions:'Historical extra\n'};
  const old=f.agents.create({name:'Old',kind:'project',description:null,projectId:null,sourceTemplateId:null,status:'active',definition:legacy});
  const oldDir=path.join(process.env.AI_WORKSPACE_AGENT_DIR,old.id,'1'),oldMetaPath=path.join(oldDir,'definition.json'),oldFile=path.join(oldDir,'AGENTS.md');
  const oldMeta=fs.readFileSync(oldMetaPath,'utf8'),oldBody=fs.readFileSync(oldFile,'utf8');assert.equal(JSON.parse(oldMeta).format,3);assert.deepEqual(f.agents.getVersion(old.id,1,old.contentSha256).definition,legacy);
  const xml=require('../src/infrastructure/agents/legacy-xml-document.server.ts').legacyXmlDocument(legacy);
  const xmlMeta=JSON.stringify({...JSON.parse(oldMeta),format:2,systemPrompt:xml.systemPrompt,instructions:xml.instructions,projects:xml.projects});
  const xmlHash=require('node:crypto').createHash('sha256').update(xmlMeta).update('\0').update(xml.markdown).digest('hex');
  fs.writeFileSync(oldMetaPath,xmlMeta);fs.writeFileSync(oldFile,xml.markdown);f.db.prepare('UPDATE agents SET content_sha256=? WHERE id=?').run(xmlHash,old.id);
  assert.deepEqual(f.agents.getVersion(old.id,1,xmlHash).definition,legacy);
  const current=f.catalog.getAgent(old.id);f.catalog.updateAgent(old.id,{definition:custom(oldBody),writeETag:roleETag(current)});
  assert.equal(fs.readFileSync(path.join(process.env.AI_WORKSPACE_AGENT_DIR,old.id,'2','AGENTS.md'),'utf8'),oldBody);assert.equal(fs.readFileSync(oldFile,'utf8'),xml.markdown);assert.equal(fs.readFileSync(oldMetaPath,'utf8'),xmlMeta);
 }finally{f.cleanup();}
});
test('prepare API analyzes only selected projects, returns raw Markdown, and revises only requested body',async()=>{
 let calls=0,seen;const source={kind:'workspace',workspaceId:'w',projectIds:['front','shared']};
 const service=createAgentPreparationService({skills:generationSkills,resolveSource(s){assert.deepEqual(s,source);return s.projectIds.map(id=>({id,name:id,collect:async()=>({sources:[{path:'AGENTS.md',hash:'a',content:`${id} evidence`}],warnings:[]})}));},generate:async input=>{calls++;seen=JSON.parse(input);return JSON.stringify({name:'前端助手',description:null,rules:seen.projects.map(p=>({id:p.id,rules:`${p.id} use <safe> & preserve`})),text:'new supplement',warnings:[]});}});
 const signal=new AbortController().signal;
 const candidate=await service.prepare({mode:'generate',source,target:'projects'},signal);assert.equal(candidate.definition.scope,'workspace');assert.equal(candidate.definition.systemPrompt,'');assert.deepEqual(candidate.definition.projects.map(p=>p.id),source.projectIds);assert.equal(candidate.markdown,'front use <safe> & preserve\n\nshared use <safe> & preserve');assert(!candidate.markdown.includes('<workspace'));assert(!candidate.markdown.includes('<project'));assert(!candidate.markdown.includes('&lt;'));assert(!candidate.markdown.includes('base_prompt'));assert.equal(seen.projects.length,1);assert.equal(seen.skill.id,'create-agentsmd');assert.equal(seen.skill.content,fs.readFileSync(path.join(process.cwd(),'skills/create-agentsmd/SKILL.md'),'utf8'));assert.equal(candidate.skill.sha256,seen.skill.sha256);assert.equal(candidate.definition.skillId,undefined);
 const current=candidate.definition;
 const revised=await service.prepare({mode:'revise',target:'projects',currentDraft:current,feedback:'调整项目规则'},signal);assert.equal(revised.definition.systemPrompt,'');assert.deepEqual(revised.definition.projects,current.projects);assert(!Object.hasOwn(revised.definition,'instructions'));
 await assert.rejects(service.prepare({mode:'generate',source:{...source,projectIds:[]}},signal),e=>e.code==='INVALID_INPUT');assert.equal(calls,4);
 const missing=createAgentPreparationService({skills:generationSkills,resolveSource:service.resolveSource??(()=>[{id:'front',name:'F',collect:async()=>({sources:[],warnings:[]})}]),generate:async()=>JSON.stringify({name:'Bad',rules:[]})});
 await assert.rejects(missing.prepare({mode:'generate',source:{kind:'project',projectId:'front'}},signal),e=>e.code==='ROLE_GENERATION_INVALID');
});
test('prepare API supports system replacement or project rules and rejects mixed or appended content',async()=>{
 const source={kind:'workspace',workspaceId:'w',projectIds:['front','back']};
 const current={format:3,mode:'generated',scope:'workspace',source,systemPrompt:'',projects:[{id:'front',name:'front',rules:'Old frontend'},{id:'back',name:'back',rules:'  untouched backend\r\n'}]};
 let answer={changes:{rules:[{id:'front',rules:'Updated frontend'}]}},seen;
 const service=createAgentPreparationService({skills:generationSkills,resolveSource:()=>source.projectIds.map(id=>({id,name:id,collect:async()=>({sources:[],warnings:[]})})),generate:async input=>{seen=JSON.parse(input);return JSON.stringify(seen.projects?.[0]?.id==='back'&&answer.changes?.rules?.[0]?.rules==='Updated frontend'?{changes:{rules:[{id:'back',rules:current.projects[1].rules}]}}:answer);}}),signal=new AbortController().signal;
 const request={mode:'revise',feedback:'调整前端规则',currentDraft:current};
 const result=await service.prepare(request,signal);assert.equal(seen.target,'auto');assert.equal(seen.assistantMode,'generated');assert.equal(result.definition.systemPrompt,'');assert.deepEqual(result.definition.projects[1],current.projects[1]);assert.equal(result.definition.projects[0].rules,'Updated frontend');
 for(const changes of [{},{instructions:'removed'},{systemPrompt:'forbidden'},{rules:[]},{rules:[{id:'outside',rules:'no'}]},{rules:[{id:'front',rules:'one'},{id:'front',rules:'two'}]}]){answer={changes};await assert.rejects(service.prepare(request,signal),e=>e.code==='ROLE_GENERATION_INVALID');}
 answer={changes:{systemPrompt:'  New system\r\n'}};const customResult=await service.prepare({...request,currentDraft:custom('Old system')},signal);assert.equal(seen.skill,null);assert.equal(customResult.definition.systemPrompt,'  New system\r\n');assert.deepEqual(customResult.definition.projects,[]);assert(!Object.hasOwn(customResult.definition,'instructions'));
 answer={changes:{rules:[{id:'front',rules:'forbidden'}]}};await assert.rejects(service.prepare({...request,currentDraft:custom('Old')},signal),e=>e.code==='ROLE_GENERATION_INVALID');
 await assert.rejects(service.prepare({...request,target:'instructions'},signal),e=>e.code==='INVALID_INPUT');await assert.rejects(service.prepare({...request,target:'systemPrompt'},signal),e=>e.code==='INVALID_INPUT');
 answer={text:'Generated system'};const initial=await service.prepare({mode:'generate',currentDraft:custom(''),requirements:'Write a system prompt'},signal);assert.equal(initial.definition.systemPrompt,'Generated system');
 const f=setup();try{for(const definition of [{...custom('valid'),instructions:''},{...custom('')},{...custom('valid'),source,scope:'project'},{...current,systemPrompt:'not allowed'},{...current,instructions:'extra'}])assert.throws(()=>f.agent(definition),e=>e.code==='INVALID_ROLE');}finally{f.cleanup();}
});
test('custom assistant APIs preserve project scope without collecting materials or modifying raw prompt',async()=>{
 const source={kind:'workspace',workspaceId:'w',projectIds:[]};let collected=0,seen;
 const service=createAgentPreparationService({skills:generationSkills,resolveSource:s=>{assert.deepEqual(s,source);return [{id:'front',name:'Front',collect:async()=>{collected++;return {sources:[],warnings:[]};}}];},generate:async input=>{seen=JSON.parse(input);return JSON.stringify({changes:{systemPrompt:'  revised raw system\r\n'}});}});
 const definition={...custom('  original raw\r\n'),scope:'workspace',source};
 const result=await service.prepare({mode:'revise',currentDraft:definition,feedback:'revise'},new AbortController().signal);
 assert.equal(collected,0);assert.equal(seen.skill,null);assert.deepEqual(seen.projects,[]);assert.deepEqual(result.definition.source,source);assert.equal(result.definition.scope,'workspace');assert.equal(result.markdown,'  revised raw system\r\n');assert.deepEqual(result.definition.projects,[]);
 const f=setup();try{const a=f.agent(definition);assert.deepEqual(f.agents.getVersion(a.id,1,a.contentSha256).definition,definition);const metadata=JSON.parse(fs.readFileSync(path.join(process.env.AI_WORKSPACE_AGENT_DIR,a.id,'1','definition.json'),'utf8'));assert.equal(fs.readFileSync(path.join(process.env.AI_WORKSPACE_AGENT_DIR,a.id,'1',metadata.systemPrompt.path),'utf8'),definition.systemPrompt);assert.equal(f.agent({...definition,source:{...source,projectIds:[]}}).definition.source.projectIds.length,0);assert.throws(()=>f.agent({...definition,source:{...source,projectIds:['front','back']}}),e=>e.code==='INVALID_ROLE');}finally{f.cleanup();}
});
test('custom input polishing API sends full material and returns only the LLM result with scope preserved',async()=>{
 const inputText='用户材料\n'+'完整要求。'.repeat(1200),source={kind:'workspace',workspaceId:'w',projectIds:[]};let seen,calls=0,fail=false;
 const service=createAgentPreparationService({skills:generationSkills,resolveSource:()=>[{id:'p',name:'P',collect:async()=>{throw Error('must not collect');}}],generate:async input=>{calls++;seen=JSON.parse(input);if(fail)throw Error('controlled model failure');return JSON.stringify({name:'润色助手',text:'清晰完整的系统提示词'});}});
 const currentDraft={...custom('existing system'),scope:'workspace',source},request={mode:'generate',currentDraft,inputText,requirements:'润色材料'};
 const result=await service.prepare(request,new AbortController().signal);assert.equal(seen.inputText,inputText);assert.equal(seen.skill,null);assert.deepEqual(seen.projects,[]);assert.equal(result.definition.systemPrompt,'清晰完整的系统提示词');assert.deepEqual(result.definition.source,source);assert.equal(currentDraft.systemPrompt,'existing system');
 fail=true;await assert.rejects(service.prepare(request,new AbortController().signal),/controlled model failure/);assert.equal(currentDraft.systemPrompt,'existing system');
 const before=calls;for(const invalid of ['', ' ', '中'.repeat(90000)])await assert.rejects(service.prepare({...request,inputText:invalid},new AbortController().signal),e=>e.code==='INVALID_INPUT');assert.equal(calls,before);
 const aborted=new AbortController();aborted.abort();await assert.rejects(service.prepare(request,aborted.signal),e=>e.code==='REQUEST_ABORTED');assert.equal(calls,before);
});
test('workspace assistant APIs reject workspace rules in generated sources and custom project selection',async()=>{
 const f=setup();try{
  const source={kind:'workspace',workspaceId:'w',projectIds:['p','q']};
  const definition={format:3,mode:'generated',scope:'workspace',source,systemPrompt:'',projects:[{id:'p',name:'P',rules:'P only'},{id:'q',name:'Q',rules:'Q only'}]};
  const a=f.agent(definition),dir=path.join(process.env.AI_WORKSPACE_AGENT_DIR,a.id,'1'),meta=JSON.parse(fs.readFileSync(path.join(dir,'definition.json'),'utf8'));
  assert.equal(fs.existsSync(path.join(dir,'workspace','AGENTS.md')),false);assert.notEqual(meta.projects[0].file.path,meta.projects[1].file.path);assert.deepEqual(f.agents.getVersion(a.id,1,a.contentSha256).definition,definition);
  assert.throws(()=>f.agent({...definition,workspaceRules:'not a project'}),e=>e.code==='INVALID_ROLE');
  let calls=0;const service=createAgentPreparationService({skills:generationSkills,resolveSource:()=>[],generate:async()=>{calls++;return '{}';}});
  for(const projectIds of [['p'],['p','q']]){
   const draft={...custom('Custom'),scope:'workspace',source:{...source,projectIds}};
   assert.throws(()=>f.agent(draft),e=>e.code==='INVALID_ROLE');await assert.rejects(service.prepare({mode:'revise',currentDraft:draft,feedback:'change'},new AbortController().signal),e=>e.code==='INVALID_INPUT');
  }
  await assert.rejects(service.prepare({mode:'generate',target:'workspaceRules',currentDraft:definition},new AbortController().signal),e=>e.code==='INVALID_INPUT');assert.equal(calls,0);
  const workspaceCustom=f.agent({...custom('Workspace system'),scope:'workspace',source:{...source,projectIds:[]}});assert.equal(fs.readFileSync(path.join(process.env.AI_WORKSPACE_AGENT_DIR,workspaceCustom.id,'1','workspace','AGENTS.md'),'utf8'),'Workspace system');
  fs.appendFileSync(path.join(dir,meta.projects[1].file.path),'tampered');assert.throws(()=>f.agents.getVersion(a.id,1,a.contentSha256),e=>e.code==='ROLE_VERSION_MISSING');
 }finally{f.cleanup();}
});
test('generation skill list and prepare APIs discover local skills, default to complete upstream content and reject invalid selections before inference',async()=>{
 const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'pi-generation-skills-'));
 const install=(id,content)=>{fs.mkdirSync(path.join(root,id),{recursive:true});fs.writeFileSync(path.join(root,id,'SKILL.md'),content);};
 const upstream=fs.readFileSync(path.join(process.cwd(),'skills/create-agentsmd/SKILL.md'),'utf8');
 install('create-agentsmd',upstream);install('extra-skill',"---\nname: extra-skill\ndescription: 'Other guidance'\n---\nKeep rules precise.\n");
 let calls=0,seen;const skills=createGenerationSkills(root),service=createAgentPreparationService({skills,resolveSource:()=>[{id:'p',name:'P',collect:async()=>({sources:[],warnings:[]})}],generate:async input=>{calls++;seen=JSON.parse(input);return JSON.stringify({name:'Result',rules:[{id:'p',rules:'Actual project rules'}],text:'Revised primary'});}});
 const routePath=require.resolve('../src/app/api/agents/skills/route.ts'),load=Module._load;let route;
 try{
  delete require.cache[routePath];Module._load=function(name,...args){if(name==='@/bootstrap/composition-root.server')return {services:{agentPreparation:service}};return load.call(this,name,...args);};try{route=require(routePath);}finally{Module._load=load;}
  const response=await route.GET(),body=await response.json();assert.equal(response.status,200);assert.equal(body.data.defaultSkillId,'create-agentsmd');assert.deepEqual(body.data.skills.map(s=>s.id),['create-agentsmd','extra-skill']);assert(body.data.skills.every(s=>!('content' in s)));assert.match(response.headers.get('cache-control'),/no-store/);
  const request={mode:'generate',source:{kind:'project',projectId:'p'}},signal=new AbortController().signal;
  const result=await service.prepare(request,signal);assert.equal(seen.skill.content,upstream);assert.equal(result.skill.sha256,require('node:crypto').createHash('sha256').update(upstream).digest('hex'));assert(!result.markdown.includes('Example Template'));
  await service.prepare({...request,skillId:'extra-skill'},signal);assert.equal(seen.skill.id,'extra-skill');
  const direct=await service.prepare({...request,skillId:null},signal);assert.equal(seen.skill,null);assert.equal(direct.skill,null);
  await service.prepare({mode:'revise',target:'systemPrompt',feedback:'revise',currentDraft:custom('keep')},signal);assert.equal(seen.skill,null);
  const before=calls;
  for(const skillId of ['../create-agentsmd','/tmp/file','',42,{},false])await assert.rejects(service.prepare({...request,skillId},signal),e=>e.code==='INVALID_INPUT');
  await assert.rejects(service.prepare({...request,skillId:'missing'},signal),e=>e.code==='GENERATION_SKILL_NOT_FOUND');
  fs.symlinkSync(path.join(root,'extra-skill'),path.join(root,'linked-skill'));await assert.rejects(service.prepare({...request,skillId:'linked-skill'},signal),e=>e.code==='GENERATION_SKILL_UNAVAILABLE');fs.unlinkSync(path.join(root,'linked-skill'));
  install('broken','---\nname: wrong\ndescription: bad\n---\nbody');await assert.rejects(service.prepare({...request,skillId:'broken'},signal),e=>e.code==='GENERATION_SKILL_UNAVAILABLE');fs.rmSync(path.join(root,'broken'),{recursive:true});
  install('oversized','x'.repeat(131073));await assert.rejects(service.prepare({...request,skillId:'oversized'},signal),e=>e.code==='GENERATION_SKILL_UNAVAILABLE');fs.rmSync(path.join(root,'oversized'),{recursive:true});
  fs.rmSync(path.join(root,'create-agentsmd'),{recursive:true});await assert.rejects(service.prepare(request,signal),e=>e.code==='GENERATION_SKILL_NOT_FOUND');assert.equal((await route.GET()).status,404);assert.equal(calls,before);
 }finally{Module._load=load;delete require.cache[routePath];fs.rmSync(root,{recursive:true,force:true});}
});
for(const scope of ['project','workspace'])test(`${scope} assistant API enforces scope, lease, ETag, exact versions, removal and busy gates`,async()=>{
 const f=setup();let owner,session,lease,route;
 try{
  if(scope==='project'){
   owner=f.projects.create({name:'P',description:null,kind:'code',rootPath:f.a,status:'active'});session=f.sessions.create({projectId:owner.id,purpose:'',agentId:null,agentSnapshot:null,mcpIds:[],mcpSnapshots:[]});lease=await f.execution.open(session.id,'open');
   const original=Module._load,entry=require.resolve('../src/shared/protocol/project-session-api.server.ts');delete require.cache[entry];Module._load=function(name,...args){if(name==='@/bootstrap/composition-root.server')return {services:{execution:f.execution,projectSessions:{get(p,id){assert.equal(p,owner.id);assert.equal(id,session.id);}}}};return original.call(this,name,...args);};try{route=require(entry).projectSessionAction;}finally{Module._load=original;}
  }else{owner=await f.workspace.save(null,{name:'W',projects:[{rootPath:f.a},{rootPath:f.b}],defaultProjectIndex:0},'create');session=f.workspace.createSession(owner.id,{},'session');lease=await f.workspace.open(owner.id,session.id);route=createWorkspaceApi(f.workspace);}
  const request=async(method='GET',selection,etag,leaseId=lease.leaseId)=>{const req=new Request('http://localhost/assistant',{method,headers:{'content-type':'application/json','x-session-lease-id':leaseId,...(etag?{'if-match':etag}:{})},...(method==='PUT'?{body:JSON.stringify({selection})}:{})});const res=scope==='workspace'?await route(req,[owner.id,'sessions',session.id,'assistant']):await route(req,{params:Promise.resolve({projectId:owner.id,sessionId:session.id})},'assistant');return {status:res.status,...await res.json()};};
  const a=f.agent(),ref={agentId:a.id,revision:a.revision,contentSha256:a.contentSha256},initial=await request();assert.equal(initial.status,200);assert.equal(initial.data.selection,null);
  assert.equal((await request('PUT',ref,initial.data.writeETag,'bad')).status,409);assert.equal((await request('PUT',ref)).status,428);
  const selected=await request('PUT',ref,initial.data.writeETag);assert.equal(selected.status,200);assert.equal((await request('PUT',null,initial.data.writeETag)).status,409);
  const identity={scope,ownerId:owner.id,sessionId:session.id};assert.equal(createSessionAssistantStore(path.join(f.root,'selections')).read(identity).selection.agentId,a.id);
  const newer=f.catalog.updateAgent(a.id,{definition:custom('new version'),writeETag:roleETag(a)});assert.equal(f.assistants.resolve(identity).revision,1);assert.equal(newer.revision,2);
  const wp=scope==='workspace'?owner.projects[0].id:'p';const wDefinition={...custom('Scoped custom system'),scope:'workspace',source:{kind:'workspace',workspaceId:owner.id,projectIds:[]}};
  const wAgent=f.agent(wDefinition),wRef={agentId:wAgent.id,revision:1,contentSha256:wAgent.contentSha256};const changed=await request('PUT',wRef,selected.data.writeETag);assert.equal(changed.status,scope==='workspace'?200:409);
  const beforeRun=await request();let consuming;
  if(scope==='project')consuming=(async()=>{for await(const event of f.execution.send(session.id,'run')){}})();else await f.workspace.accept(owner.id,session.id,{content:'run'},'run',lease.leaseId);
  await new Promise(r=>setImmediate(r));assert.equal((await request('PUT',null,beforeRun.data.writeETag)).status,409);f.finish();if(consuming)await consuming;await new Promise(r=>setImmediate(r));
  const final=await request('PUT',null,(await request()).data.writeETag);assert.equal(final.status,200);assert.equal(final.data.selection,null);assert.equal(f.assistants.resolve(identity),null);
  if(scope==='project')await f.execution.deleteSession(owner.id,session.id);else await f.workspace.deleteSession(owner.id,session.id);
 }finally{f.cleanup();}
});

test('application send API replaces only the primary prompt, reuses fixed XML, and restores defaults after removal',async()=>{
 const pi=await import('@earendil-works/pi-coding-agent'),ai=await import('@earendil-works/pi-ai');
 const original=Module._load;Module._load=function(name,...args){return name==='@earendil-works/pi-coding-agent'?pi:name==='@earendil-works/pi-ai'?ai:original.call(this,name,...args);};
 let PiSessionRuntime,initializeSession;try{({PiSessionRuntime}=require('../src/infrastructure/pi/pi-session-runtime.server.ts'));({initializeSession}=require('./support/initialize-pi-session.ts'));}finally{Module._load=original;}
 const modelRuntime=await pi.ModelRuntime.create({credentials:{async read(){},async list(){return [];},async modify(){},async delete(){}},modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
 modelRuntime.registerProvider('fake',{name:'fake',baseUrl:'http://localhost',apiKey:'fake',api:'openai-completions',models:[{id:'fake',name:'fake',api:'openai-completions',baseUrl:'http://localhost',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1000}]});
 const runtime=new PiSessionRuntime(async()=>({runtime:modelRuntime,model:modelRuntime.getModel('fake','fake')}));const f=setup(runtime);
 try{
  const p=f.projects.create({name:'Frontend',description:null,kind:'code',rootPath:fs.realpathSync(f.a),status:'active'}),session=f.sessions.create({projectId:p.id,purpose:'',agentId:null,agentSnapshot:null,mcpIds:[],mcpSnapshots:[]});
  fs.mkdirSync(path.join(p.rootPath,'.pi'));fs.writeFileSync(path.join(p.rootPath,'.pi','SYSTEM.md'),'UNSELECTED SYSTEM OVERRIDE');
  const manager=initializeSession('fixture',p.rootPath,f.root);f.sessions.setNativeRefIfAbsent(session.id,{kind:'pi',sessionId:manager.getSessionId(),sessionFile:manager.getSessionFile(),cwd:p.rootPath});
  const lease=await f.execution.open(session.id,'open'),prompts=[];
  runtime.getHandle(session.id).session.agent.streamFunction=(_model,context)=>{prompts.push(ai.getCurrentSystemPrompt(context.messages));const stream=ai.createAssistantMessageEventStream();stream.push({type:'done',reason:'stop',message:{role:'assistant',content:[{type:'text',text:'ok'}],api:'openai-completions',provider:'fake',model:'fake',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()}});stream.end();return stream;};
  const send=async()=>{const events=[];for await(const event of f.execution.send(session.id,'test'))events.push(event);assert(!events.some(e=>e.type==='error'),JSON.stringify(events));};
  const select=agent=>f.execution.changeAssistant(session.id,{selection:agent?{agentId:agent.id,revision:agent.revision,contentSha256:agent.contentSha256}:null},f.execution.assistant(session.id).writeETag,lease.leaseId);
  const generated=f.agent({format:3,mode:'generated',scope:'project',source:{kind:'project',projectId:p.id},systemPrompt:'',projects:[{id:p.id,name:p.name,rules:'RULE <frontend>'}]});
  select(generated);await send();assert(prompts.at(-1).includes('You are a coding assistant'));assert(prompts.at(-1).includes('<project id='));assert(prompts.at(-1).includes('RULE &lt;frontend&gt;'));assert(!prompts.at(-1).includes('UNSELECTED SYSTEM OVERRIDE'));
  const replacement=f.agent(custom('CUSTOM SYSTEM'));select(replacement);await send();assert(prompts.at(-1).includes('CUSTOM SYSTEM'));assert(!prompts.at(-1).includes('CUSTOM APPEND'));assert(!prompts.at(-1).includes('You are a coding assistant'));assert(!prompts.at(-1).includes('RULE &lt;frontend&gt;'));
  select(null);await send();assert(prompts.at(-1).includes('You are a coding assistant'));assert(!prompts.at(-1).includes('CUSTOM SYSTEM'));
  await f.execution.deleteSession(p.id,session.id);
  const w=await f.workspace.save(null,{name:'Business',projects:[{rootPath:f.a},{rootPath:f.b}],defaultProjectIndex:0},'workspace');
  const ws=f.workspace.createSession(w.id,{},'workspace-session'),wm=initializeSession('workspace-fixture',w.projects[0].rootPath,f.root);
  f.repository.bindNative(w.id,ws.id,{kind:'pi',sessionId:wm.getSessionId(),sessionFile:wm.getSessionFile(),cwd:w.projects[0].rootPath});
  let wl=await f.workspace.open(w.id,ws.id);
  const wa=f.agent({format:3,mode:'generated',scope:'workspace',source:{kind:'workspace',workspaceId:w.id,projectIds:w.projects.map(x=>x.id)},systemPrompt:'',projects:w.projects.map((p,i)=>({id:p.id,name:p.name,rules:`PROJECT_${i}_RULES`}))});
  await f.workspace.changeAssistant(w.id,ws.id,{selection:{agentId:wa.id,revision:1,contentSha256:wa.contentSha256}},f.workspace.assistant(w.id,ws.id).writeETag,wl.leaseId);
  wl=await f.workspace.open(w.id,ws.id);
  let captured;const received=new Promise(resolve=>{captured=resolve;});
  runtime.getHandle(ws.id).session.agent.streamFunction=(_model,context)=>{const prompt=ai.getCurrentSystemPrompt(context.messages);captured(prompt);const stream=ai.createAssistantMessageEventStream();stream.push({type:'done',reason:'stop',message:{role:'assistant',content:[{type:'text',text:'ok'}],api:'openai-completions',provider:'fake',model:'fake',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()}});stream.end();return stream;};
  await f.workspace.accept(w.id,ws.id,{content:'workspace'},'workspace-prompt',wl.leaseId);
  const workspaceSystem=await received;assert.equal((workspaceSystem.match(/<workspace /g)||[]).length,1);assert(workspaceSystem.includes('PROJECT_0_RULES'));assert(workspaceSystem.includes('PROJECT_1_RULES'));assert(!workspaceSystem.includes('WORKSPACE &lt;COORDINATION&gt;'));assert(workspaceSystem.includes('You are a coding assistant'));
  await f.workspace.deleteSession(w.id,ws.id);
 }finally{f.cleanup();}
});
