require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createProjectRulesStore}=require('../src/infrastructure/agents/project-rules-store.server.ts');
const {createProjectRuleGenerationsStore}=require('../src/infrastructure/agents/project-rule-generations.server.ts');
const {createProjectRulesService}=require('../src/application/project-rules-service.ts');
const {createProjectRulesApi}=require('../src/shared/protocol/project-rules-api.server.ts');
const {createAgentPreparationService}=require('../src/application/agent-service.ts');
const {DomainError}=require('../src/domain/errors.ts');
const identity={scope:'project',projectId:'p'},tick=()=>new Promise(setImmediate);
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'project-rule-task-')),store=createProjectRulesStore(root),generations=createProjectRuleGenerationsStore(root),calls=[];
 const prepare=createAgentPreparationService({skills:{list:()=>({skills:[],defaultSkillId:'chosen'}),read:id=>{if(id!=='chosen')throw new DomainError('GENERATION_SKILL_NOT_FOUND','missing skill',404,true);return {id,name:id,description:'chosen',content:'FULL SELECTED SKILL',sha256:'a'.repeat(64)};}},resolveSource:source=>[{id:source.kind==='project'?source.projectId:source.projectIds[0],name:'Project',rootPath:root}],generate:(input,signal,_mode,context)=>new Promise((resolve,reject)=>{const value=JSON.parse(input);const call={input:value,signal,progress:()=>context.onRead('read'),resolve:()=>resolve(JSON.stringify({rules:[{id:value.projects[0].id,rules:'# Completed project rules'}]})),fail:()=>reject(new DomainError('ROLE_GENERATION_FAILED','Controlled model failure',503,true))};calls.push(call);signal.addEventListener('abort',()=>reject(new DomainError('REQUEST_ABORTED','aborted',409,true)),{once:true});})});
 const source={rootPath:root};const resolve=id=>{if(id.projectId!=='p'||id.scope==='workspace'&&id.workspaceId!=='w')throw new DomainError('REFERENCE_OUTSIDE_SCOPE','outside',403,true);return {id:'p',name:'Project',rootPath:source.rootPath};};
 const create=()=>createProjectRulesService({store,generations,prepare,resolve}),service=create(),route=createProjectRulesApi(service);
 const request=(method,body={},etag,key='test-key',id=identity,signal)=>route(new Request('http://localhost/api/projects/p/agent-rules',{method,headers:{'content-type':'application/json',...(etag?{'if-match':etag}:{}),...(key?{'idempotency-key':key}:{})},...(method==='GET'?{}:{body:JSON.stringify(body)}),signal}),id);
 return {root,source,store,generations,calls,service,create,request,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('rule revision API requires existing rules and nonempty feedback before queuing',async()=>{const f=fixture();try{
 const initial=f.store.read(identity);
 for(const mode of ['unknown',null,['revise']])assert.equal((await f.request('POST',{mode,requirements:'Edit'},initial.writeETag)).status,400);
 assert.equal((await f.request('POST',{mode:'revise',requirements:' '},initial.writeETag)).status,400);
 const missing=await f.request('POST',{mode:'revise',requirements:'Edit'},initial.writeETag);assert.equal(missing.status,409);assert.equal((await missing.json()).error.code,'PROJECT_RULES_REQUIRED');
 assert.equal(f.generations.list(identity).length,0);assert.equal(f.calls.length,0);
 }finally{f.close();}});
test('revision API supplies server-owned full rules and publishes an immutable version in each scope',async()=>{const f=fixture();try{
 for(const [index,id] of [identity,{scope:'workspace',workspaceId:'w',projectId:'p'}].entries()){
  let old=f.store.write(id,f.store.read(id).writeETag,{markdown:'# Original\n\nKeep existing constraints.'});old=f.store.write(id,old.writeETag,{enabled:true});
  const body={mode:'revise',requirements:'Clarify the build instructions',skillId:null};
  assert.equal((await f.request('POST',{...body,currentDraft:'untrusted'},old.writeETag,'bad',id)).status,400);
  const response=await f.request('POST',body,old.writeETag,'revise',id);assert.equal(response.status,202);const task=(await response.json()).data.generation;assert.equal(task.mode,'revise');
  const repeated=(await (await f.request('POST',body,old.writeETag,'revise',id)).json()).data;assert.equal(repeated.generation.id,task.id);
  const conflict=await f.request('POST',{...body,mode:'generate'},old.writeETag,'revise',id);assert.equal((await conflict.json()).error.code,'IDEMPOTENCY_CONFLICT');
  await tick();const call=f.calls[index];assert.equal(call.input.mode,'revise');assert.equal(call.input.target,'projects');assert.equal(call.input.feedback,body.requirements);assert.equal(call.input.previous.projects.length,1);assert.equal(call.input.previous.projects[0].rules,old.markdown);assert.equal(call.input.skill,null);
  assert.deepEqual(f.store.read(id),old);call.resolve();await tick();const done=f.service.read(id);assert.equal(done.generation.status,'succeeded');assert.equal(done.revision,old.revision+1);assert.equal(done.enabled,true);assert.equal(done.markdown,'# Completed project rules');assert.equal(f.create().read(id).generation.mode,'revise');
 }
 }finally{f.close();}});
test('revision cancellation, failure and concurrent edits preserve saved rules',async()=>{const f=fixture();try{
 let old=f.store.write(identity,f.store.read(identity).writeETag,{markdown:'# Existing rules'});old=f.store.write(identity,old.writeETag,{enabled:true});
 const body={mode:'revise',requirements:'Improve wording'};
 const task=(await (await f.request('POST',body,old.writeETag,'cancel-revision')).json()).data.generation;await tick();await f.request('PATCH',{generationId:task.id,action:'cancel'});await tick();assert.equal(f.service.read(identity).generation.status,'cancelled');assert.deepEqual(f.store.read(identity),old);
 await f.request('POST',body,old.writeETag,'failed-revision');await tick();f.calls[1].fail();await tick();assert.equal(f.service.read(identity).generation.status,'failed');assert.deepEqual(f.store.read(identity),old);
 await f.request('POST',body,old.writeETag,'conflicted-revision');await tick();const edited=f.store.write(identity,old.writeETag,{markdown:'# New concurrent rules'});f.calls[2].resolve();await tick();assert.equal(f.service.read(identity).generation.error.code,'WRITE_CONFLICT');assert.deepEqual(f.store.read(identity),edited);
 }finally{f.close();}});
test('POST accepts durable generation, ignores HTTP disconnect and GET recovers progress and publication',async()=>{const f=fixture();try{
 const abort=new AbortController(),initial=f.service.read(identity),response=await f.request('POST',{requirements:'Check the project'},initial.writeETag,'one',identity,abort.signal);
 assert.equal(response.status,202);const accepted=(await response.json()).data;assert.equal(accepted.generation.status,'queued');assert.equal(accepted.generation.skillId,null);assert.equal(accepted.generation.requestKey,undefined);assert.equal(accepted.generation.baseETag,undefined);
 abort.abort();await tick();assert.equal(f.calls.length,1);assert.equal(f.calls[0].signal.aborted,false);assert.equal(f.calls[0].input.skill,null);f.calls[0].progress();
 const running=(await (await f.request('GET')).json()).data;assert.equal(running.generation.id,accepted.generation.id);assert.equal(running.generation.status,'running');assert.equal(running.generation.progress.tool,'read');assert(!JSON.stringify(running).includes(f.root));
 f.calls[0].resolve();await tick();const done=f.service.read(identity);assert.equal(done.generation.status,'succeeded');assert.equal(done.revision,1);assert.equal(done.enabled,false);assert.equal(done.generation.resultRevision,1);assert.equal(done.markdown,'# Completed project rules');assert.equal(f.create().read(identity).generation.status,'succeeded');
 }finally{f.close();}});
test('generation API checks input, skills, ETag, idempotency and one active job per project',async()=>{const f=fixture();try{
 const v=f.service.read(identity);assert.equal((await f.request('POST',{},v.writeETag,'')).status,400);assert.equal((await f.request('POST',{},undefined)).status,428);assert.equal((await f.request('POST',{},'"stale"')).status,409);assert.equal((await f.request('POST',{skillId:'missing'},v.writeETag)).status,404);assert.equal((await f.request('POST',{requirements:2},v.writeETag)).status,400);assert.equal(f.generations.list(identity).length,0);
 const response=await f.request('POST',{skillId:'chosen'},v.writeETag,'same'),job=(await response.json()).data.generation;await tick();assert.equal(f.calls[0].input.skill.content,'FULL SELECTED SKILL');
 const repeat=await f.request('POST',{skillId:'chosen'},v.writeETag,'same');assert.equal((await repeat.json()).data.generation.id,job.id);assert.equal(f.calls.length,1);
 const changed=await f.request('POST',{skillId:null},v.writeETag,'same');assert.equal((await changed.json()).error.code,'IDEMPOTENCY_CONFLICT');const concurrent=await f.request('POST',{},v.writeETag,'other');assert.equal((await concurrent.json()).error.code,'PROJECT_RULE_GENERATION_BUSY');
 f.calls[0].resolve();await tick();const oldReplay=await f.request('POST',{skillId:'chosen'},v.writeETag,'same');assert.equal((await oldReplay.json()).data.generation.status,'succeeded');assert.equal(f.calls.length,1);
 const legacy=f.generations.list(identity)[0];delete legacy.mode;f.generations.save(identity,legacy);const legacyFile=path.join(f.root,fs.readdirSync(f.root)[0],'generations',legacy.id+'.json'),before=fs.readFileSync(legacyFile,'utf8');assert.equal(f.create().read(identity).generation.mode,'generate');assert.equal((await f.request('POST',{mode:'generate',skillId:'chosen'},v.writeETag,'same')).status,202);assert.equal(fs.readFileSync(legacyFile,'utf8'),before);assert.equal(f.calls.length,1);
 }finally{f.close();}});
test('explicit cancellation and failure preserve old rules; next attempt uses a new id',async()=>{const f=fixture();try{
 let old=f.store.write(identity,f.store.read(identity).writeETag,{markdown:'# Existing'});old=f.store.write(identity,old.writeETag,{enabled:true});
 const accepted=(await (await f.request('POST',{},old.writeETag,'cancel')).json()).data;await tick();assert.equal((await f.request('PATCH',{generationId:accepted.generation.id,action:'cancel'})).status,200);await tick();assert.equal(f.service.read(identity).generation.status,'cancelled');assert.deepEqual(f.store.read(identity),old);
 assert.equal((await f.request('PATCH',{generationId:accepted.generation.id,action:'cancel'})).status,200);
 const next=(await (await f.request('POST',{},old.writeETag,'retry')).json()).data;assert.notEqual(next.generation.id,accepted.generation.id);await tick();f.calls[1].fail();await tick();assert.equal(f.service.read(identity).generation.status,'failed');assert.equal(f.service.read(identity).generation.error.code,'ROLE_GENERATION_FAILED');assert.deepEqual(f.store.read(identity),old);
 assert.equal((await f.request('PATCH',{generationId:'unknown',action:'cancel'})).status,404);
 }finally{f.close();}});
test('concurrent rule switch prevents stale generation publication',async()=>{const f=fixture();try{
 const old=f.store.write(identity,f.store.read(identity).writeETag,{markdown:'Original'});await f.request('POST',{},old.writeETag,'one');await tick();const enabled=await f.request('PUT',{enabled:true},old.writeETag);assert.equal(enabled.status,200);f.calls[0].resolve();await tick();const result=f.service.read(identity);assert.equal(result.generation.status,'failed');assert.equal(result.generation.error.code,'WRITE_CONFLICT');assert.equal(result.markdown,'Original');assert.equal(result.enabled,true);assert.equal(result.revision,1);
 }finally{f.close();}});
test('generation cannot publish facts collected from an old project directory',async()=>{const f=fixture();try{
 const old=f.store.write(identity,f.store.read(identity).writeETag,{markdown:'Original'});await f.request('POST',{},old.writeETag,'move');await tick();f.source.rootPath=path.join(f.root,'changed');f.calls[0].resolve();await tick();assert.equal(f.service.read(identity).generation.error.code,'WRITE_CONFLICT');assert.deepEqual(f.store.read(identity),old);
 }finally{f.close();}});
test('task identities isolate standalone and workspace projects, including cancellation',async()=>{const f=fixture();try{
 const member={scope:'workspace',workspaceId:'w',projectId:'p'};await f.request('POST',{},f.store.read(identity).writeETag,'same');const other=(await (await f.request('POST',{},f.store.read(member).writeETag,'same',member)).json()).data;await tick();assert.equal(f.calls.length,2);
 assert.equal((await f.request('PATCH',{generationId:other.generation.id,action:'cancel'},undefined,'key',identity)).status,404);
 assert.equal((await f.request('POST',{},f.store.read(member).writeETag,'key',{...member,workspaceId:'other'})).status,403);
 f.calls.forEach(c=>c.resolve());await tick();assert.equal(f.service.read(identity).revision,1);assert.equal(f.service.read(member).revision,1);
 }finally{f.close();}});
test('service recreation marks unfinished jobs interrupted and reconciles a published result without rerunning',async()=>{const f=fixture();try{
 const initial=f.store.read(identity);await f.request('POST',{},initial.writeETag,'first');await tick();f.calls[0].resolve();await tick();const done=f.generations.list(identity)[0],rules=f.store.read(identity);
 f.generations.save(identity,{...done,status:'running',completedAt:null,resultRevision:null,resultSha256:null});const interrupted=f.create().read(identity);assert.equal(interrupted.generation.status,'interrupted');assert.equal(interrupted.generation.error.code,'GENERATION_INTERRUPTED');assert.equal(f.calls.length,1);
 f.generations.save(identity,{...done,status:'publishing',inputRevision:0,resultRevision:null,completedAt:null,resultSha256:rules.contentSha256});const confirmed=f.create().read(identity);assert.equal(confirmed.generation.status,'succeeded');assert.equal(confirmed.generation.resultRevision,1);assert.equal(f.calls.length,1);
 const file=path.join(f.root,fs.readdirSync(f.root)[0],'generations',done.id+'.json');fs.writeFileSync(file,'broken');assert.throws(()=>f.create().read(identity),e=>e.code==='PROJECT_RULE_GENERATIONS_UNAVAILABLE');assert.deepEqual(f.store.read(identity),rules);
 }finally{f.close();}});
