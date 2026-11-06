require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./workspace-fixture.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('Workspace message API validates server search, forwards intent, and distinguishes search idempotency',async()=>{
 const f=fixture();let lease,s,w;try{
  w=await f.service.save(null,{name:'Work',projects:[{rootPath:f.a}],defaultProjectIndex:0},'w');s=f.service.createSession(w.id,{},'s');lease=(await f.service.open(w.id,s.id)).leaseId;
  const {createWorkspaceApi}=require('../src/shared/protocol/workspace-api.server.ts'),handle=createWorkspaceApi(f.service);
  async function call(body,key){const response=await handle(new Request('http://localhost/api/workspaces/'+w.id+'/sessions/'+s.id+'/messages',{method:'POST',headers:{'content-type':'application/json','idempotency-key':key,'x-session-lease-id':lease},body:JSON.stringify(body)}),[w.id,'sessions',s.id,'messages']);return {status:response.status,payload:await response.json()};}
  for(const webSearch of ['true',null,1])assert.equal((await call({content:'search',webSearch},'invalid')).status,400);
  assert.equal((await call({content:'search',webSearch:true},'search')).status,422);assert.equal((f.persisted.get(s.id)??[]).length,0);
  const seen=[],original=f.runtime.send.bind(f.runtime);f.runtime.validateWebSearch=()=>{};f.runtime.send=(...args)=>{seen.push(args[6]);return original(...args);};
  assert.equal((await call({content:'search',webSearch:true},'search')).status,202);assert.deepEqual(seen,[true]);f.finish();await tick();
  assert.equal((await call({content:'search',webSearch:true},'search')).status,202);assert.equal(seen.length,1);
  assert.equal((await call({content:'search',webSearch:false},'search')).status,409);
  assert.equal((await call({content:'plain',webSearch:false},'plain')).status,202);assert.equal(seen.at(-1),false);f.finish();await tick();
  assert.equal((await call({content:'plain'},'plain')).status,202);assert.equal(seen.length,2);
 }finally{if(lease)f.service.close(s.id,lease);f.close();}
});

test('Workspace tool search validates before journaling and supports independent and combined choices',async()=>{
 const f=fixture();let lease,s,w;try{
  w=await f.service.save(null,{name:'Work',projects:[{rootPath:f.a}],defaultProjectIndex:0},'w');s=f.service.createSession(w.id,{},'s');lease=(await f.service.open(w.id,s.id)).leaseId;
  for(const toolSearch of [null,1,'true'])await assert.rejects(f.service.accept(w.id,s.id,{content:'q',toolSearch},'bad',lease),e=>e.code==='INVALID_INPUT');
  await assert.rejects(f.service.accept(w.id,s.id,{content:'q',toolSearch:true},'tools',lease),e=>e.code==='TOOL_SEARCH_UNAVAILABLE');assert.equal((f.persisted.get(s.id)??[]).length,0);
  const seen=[],original=f.runtime.send.bind(f.runtime);f.runtime.validateToolSearch=()=>{};f.runtime.validateWebSearch=()=>{};f.runtime.send=(...args)=>{seen.push([args[6],args[7]]);return original(...args);};
  await f.service.accept(w.id,s.id,{content:'q',toolSearch:true,webSearch:false},'tools',lease);assert.deepEqual(seen[0],[false,true]);f.finish();await tick();
  await f.service.accept(w.id,s.id,{content:'q',toolSearch:true},'tools',lease);assert.equal(seen.length,1);
  await assert.rejects(f.service.accept(w.id,s.id,{content:'q',toolSearch:false},'tools',lease),e=>e.code==='IDEMPOTENCY_CONFLICT');
  await f.service.accept(w.id,s.id,{content:'both',toolSearch:true,webSearch:true},'both',lease);assert.deepEqual(seen[1],[true,true]);f.finish();await tick();
  await f.service.accept(w.id,s.id,{content:'off',toolSearch:false,webSearch:false},'off',lease);f.finish();await tick();await f.service.accept(w.id,s.id,{content:'off'},'off',lease);assert.equal(seen.length,3);
 }finally{if(lease)f.service.close(s.id,lease);f.close();}
});

test('shared HTTP client transmits explicit server and tool search choices',async()=>{
 const {submitSessionMessage}=require('../web/api/session-events.ts');const previous=global.fetch,seen=[];
 global.fetch=async(_url,options)=>{seen.push(JSON.parse(options.body));return new Response(JSON.stringify({data:{accepted:true}}),{status:202,headers:{'content-type':'application/json'}});};
 try{for(const value of [true,false])await submitSessionMessage('/api/projects/p/sessions/s','lease','original',[],value,!value);assert.deepEqual(seen,[{content:'original',references:[],webSearch:true,toolSearch:false},{content:'original',references:[],webSearch:false,toolSearch:true}]);}finally{global.fetch=previous;}
});
