require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const {fixture}=require('./workspace-fixture.cjs');
const {DomainError}=require('../src/domain/errors.ts');
const {createSessionRepository}=require('../src/infrastructure/database/session-repository.ts');
const {createProjectRepository}=require('../src/infrastructure/database/project-repository.ts');
const {createProjectOperationStore}=require('../src/infrastructure/projects/operation-journal.server.ts');
const {createSessionExecutionService}=require('../src/application/session-execution-service.ts');
const {createSessionToolsService}=require('../src/application/session-tools-service.ts');
const {createProjectSessionService}=require('../src/application/project-session-service.ts');
const {createWorkspaceApi}=require('../src/shared/protocol/workspace-api.server.ts');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function projectFixture(){
 const f=fixture(),projects=createProjectRepository(f.db),sessions=createSessionRepository(f.db),operations=createProjectOperationStore(f.root);
 const p=projects.create({name:'P',description:null,kind:'code',rootPath:f.a,status:'active'});
 const s=sessions.create({projectId:p.id,purpose:'test',agentId:null,agentSnapshot:null,mcpIds:[],mcpSnapshots:[]});
 const handle={},main=deferred(),steered=[];let live=false,closed=false;
 const runtime={getHandle:()=>closed?undefined:handle,refreshModel:async()=>{},subscribe:()=>()=>{},operationEvidence:()=>({}),readTree:async()=>({entries:[],activeLeafId:null}),
  send:async()=>{live=true;await main.promise;live=false;},steer:async(h,text)=>{assert.equal(h,handle);if(!live)throw new DomainError('SESSION_NOT_RUNNING','idle',409,true);steered.push(text);},interrupt:async()=>{main.resolve();},close:async()=>{closed=true;}};
 const execution=createSessionExecutionService({sessions,projects,runtime,catalog:{}});
 const lease=await execution.open(s.id,'open');
 const tools=createSessionToolsService({sessions,projects,runtime,operations,execution,catalog:{},assertWritable(){},present:row=>row});
 const projectSessions=createProjectSessionService({sessions,projects,operations,hasLease:execution.hasLease,operationRunning:tools.running});
 const loader=Module._load;let route;
 Module._load=function(name,...args){if(name==='@/bootstrap/composition-root.server')return {services:{execution,sessionTools:tools,projectSessions}};return loader.call(this,name,...args);};
 const shared=require.resolve('../src/shared/protocol/project-session-api.server.ts'),entry=require.resolve('../src/app/api/projects/[projectId]/sessions/[sessionId]/steer/route.ts');
 delete require.cache[shared];delete require.cache[entry];
 try{route=require(entry);}finally{Module._load=loader;}
 async function call(body,key='correction',owner=p.id,leaseId=lease.leaseId){const response=await route.POST(new Request('http://localhost/steer',{method:'POST',headers:{'content-type':'application/json','idempotency-key':key,'x-session-lease-id':leaseId},body:JSON.stringify(body)}),{params:Promise.resolve({projectId:owner,sessionId:s.id})});return {status:response.status,...await response.json()};}
 return {...f,p,s,sessions,operations,execution,tools,runtime,steered,call,lease,async closeAll(){main.resolve();await tick();delete require.cache[shared];delete require.cache[entry];await execution.deleteSession(p.id,s.id);f.close();}};
}
async function workspaceFixture(){const f=fixture(),w=await f.service.save(null,{name:'W',projects:[{rootPath:f.a}],defaultProjectIndex:0},'w'),s=f.service.createSession(w.id,{},'s'),lease=await f.service.open(w.id,s.id),api=createWorkspaceApi(f.service),steered=[];f.runtime.steer=async(h,text)=>{steered.push(text);};
 return {...f,w,s,lease,steered,async call(body,key='correction',owner=w.id,leaseId=lease.leaseId){const response=await api(new Request('http://localhost/steer',{method:'POST',headers:{'content-type':'application/json','idempotency-key':key,'x-session-lease-id':leaseId},body:JSON.stringify(body)}),[owner,'sessions',s.id,'steer']);return {status:response.status,...await response.json()};},async closeAll(){f.finish();await tick();await f.service.deleteSession(w.id,s.id);f.close();}};
}
for(const mode of ['project','workspace'])test(`${mode} steer HTTP validates ownership, lease, body and active run; deduplicates without replacing the root request`,async()=>{
 const f=await(mode==='project'?projectFixture():workspaceFixture());try{
  assert.equal((await f.call({content:'x'},'a','wrong')).status,404);
  assert.equal((await f.call({content:'x'},'a',undefined,'wrong')).status,409);
  assert.equal((await f.call({content:' '})).status,400);
  assert.equal((await f.call({content:'x',references:[]})).status,400);
  assert.equal((await f.call({content:'x'.repeat(32769)})).status,413);
  assert.equal((await f.call({content:'x'},'')).status,400);
  assert.equal((await f.call({content:'x'},'idle')).error.code,'SESSION_NOT_RUNNING');
  if(mode==='project')f.tools.accept(f.p.id,f.s.id,{content:'original'},'root',f.lease.leaseId);
  else await f.service.accept(f.w.id,f.s.id,{content:'original'},'root',f.lease.leaseId);
  await tick();
  const barrier=deferred(),original=f.runtime.steer;f.runtime.steer=async(...args)=>{await barrier.promise;return original(...args);};
  const first=f.call({content:'  先别修改，只分析  '}),second=f.call({content:'  先别修改，只分析  '});
  await tick();barrier.resolve();
  const [a,b]=await Promise.all([first,second]);assert.equal(a.status,202);assert.deepEqual(a.data,b.data);assert.equal(a.data.delivery,'steer');assert.deepEqual(f.steered,['  先别修改，只分析  ']);
  assert.equal((await f.call({content:'other'})).error.code,'IDEMPOTENCY_CONFLICT');
  assert.equal((await f.call({content:'  先别修改，只分析  '})).status,202);assert.equal(f.steered.length,1);
  if(mode==='project'){assert.equal(f.sessions.get(f.s.id).state,'running');assert.equal(f.operations.list(f.p.id,f.s.id).filter(x=>x.operation==='message')[0].phase,'prepared');await f.execution.interrupt(f.s.id);}
  else{assert.equal(f.sent.length,1);assert(f.service.session(f.w.id,f.s.id).allowedActions.includes('steer'));await f.service.interrupt(f.w.id,f.s.id);}
  assert.equal((await f.call({content:'too late'},'late')).error.code,'SESSION_NOT_RUNNING');assert.equal(f.steered.length,1);
 }finally{await f.closeAll();}
});
for(const mode of ['project','workspace'])test(`${mode} steer unknown receipt cannot be replayed`,async()=>{
 const f=await(mode==='project'?projectFixture():workspaceFixture());try{
  if(mode==='project')f.tools.accept(f.p.id,f.s.id,{content:'original'},'root',f.lease.leaseId);else await f.service.accept(f.w.id,f.s.id,{content:'original'},'root',f.lease.leaseId);
  await tick();let calls=0;f.runtime.steer=async()=>{calls++;throw Error('lost receipt');};
  assert.equal((await f.call({content:'correction'},'lost')).error.code,'REQUEST_UNKNOWN');
  assert.equal((await f.call({content:'correction'},'lost')).error.code,'REQUEST_UNKNOWN');assert.equal(calls,1);
  assert.equal((await f.call({content:'another'},'new')).error.code,'REQUEST_UNKNOWN');assert.equal(calls,1);
 }finally{await f.closeAll();}
});
for(const mode of ['project','workspace'])test(`${mode} deletion waits for an in-flight steer and rejects later steer requests`,async()=>{
 const f=await(mode==='project'?projectFixture():workspaceFixture());let deleted=false;try{
  if(mode==='project')f.tools.accept(f.p.id,f.s.id,{content:'root'},'root',f.lease.leaseId);else await f.service.accept(f.w.id,f.s.id,{content:'root'},'root',f.lease.leaseId);
  await tick();const gate=deferred(),entered=deferred();f.runtime.steer=async()=>{entered.resolve();await gate.promise;throw new DomainError('REQUEST_ABORTED','stopped',409,true);};
  const correcting=f.call({content:'correction'});await entered.promise;
  const deletion=(mode==='project'?f.execution.deleteSession(f.p.id,f.s.id):f.service.deleteSession(f.w.id,f.s.id)).then(()=>{deleted=true;});
  await tick();assert.equal(deleted,false);assert.equal((await f.call({content:'late'},'late')).error.code,'SESSION_BUSY');
  gate.resolve();assert.equal((await correcting).status,409);await deletion;assert.equal(deleted,true);
 }finally{if(deleted)f.close();else await f.closeAll();}
});
test('Workspace SSE ready projects the current Pi steering queue on reconnect',async()=>{
 const f=await workspaceFixture();try{
  f.runtime.steeringQueue=()=>['pending correction'];
  const api=createWorkspaceApi(f.service),response=await api(new Request(`http://localhost/events?leaseId=${f.lease.leaseId}`),[f.w.id,'sessions',f.s.id,'events']);
  assert.equal(response.status,200);const reader=response.body.getReader(),first=await reader.read(),frame=new TextDecoder().decode(first.value);
  assert(frame.includes('pending correction'));await reader.cancel();
 }finally{await f.closeAll();}
});
test('Workspace steer rejects compaction and deletion; its journal accepts queued receipts without changing session records',async()=>{
 const f=await workspaceFixture();try{
  const before=f.repository.session(f.w.id,f.s.id),compact=deferred();f.runtime.compact=()=>compact.promise;
  await f.service.compact(f.w.id,f.s.id);assert.equal((await f.call({content:'during compact'},'compact')).error.code,'SESSION_BUSY');compact.resolve();await tick();
  await f.service.accept(f.w.id,f.s.id,{content:'root'},'root',f.lease.leaseId);
  await f.call({content:'correction'});assert.deepEqual(f.repository.session(f.w.id,f.s.id),before);
  const {appendWorkspaceRequest,readWorkspaceRequests}=require('../src/infrastructure/workspaces/request-journal.server.ts');
  const identity={sessionId:f.s.id,workspaceId:f.w.id,nativeSessionId:f.s.id,sessionFile:path.join(f.root,'native')};
  appendWorkspaceRequest(identity,'workspace_request',{key:'k',hash:'h',operation:'steer'});appendWorkspaceRequest(identity,'workspace_request_result',{key:'k',hash:'h',operation:'steer',outcome:'queued'});assert.equal(readWorkspaceRequests(identity).length,2);
  const deletion=f.service.deleteSession(f.w.id,f.s.id);assert.equal((await f.call({content:'during delete'},'delete')).error.code,'SESSION_BUSY');await deletion;
 }finally{f.close();}
});
