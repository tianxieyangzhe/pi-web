const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./workspace-fixture.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('a failed settlement journal write remains unknown rather than creating a false failure receipt',async()=>{
 const f=fixture();try{
  const {DomainError}=require('../src/domain/errors.ts');
  const w=await f.service.save(null,{name:'Work',projects:[{rootPath:f.a}],defaultProjectIndex:0},'w');const s=f.service.createSession(w.id,{},'s'),opened=await f.service.open(w.id,s.id);
  const append=f.runtime.requestEntry.bind(f.runtime);f.runtime.requestEntry=(handle,type,data)=>{if(type==='workspace_request_result')throw new DomainError('REQUEST_UNKNOWN','journal unavailable',409,true);return append(handle,type,data);};
  await f.service.accept(w.id,s.id,{content:'request'},'m',opened.leaseId);f.finish();await tick();
  assert.equal(f.persisted.get(s.id).length,1);assert.equal((await f.service.recover(w.id,s.id,'inspect')).pending.length,1);
  await assert.rejects(f.service.accept(w.id,s.id,{content:'new'},'m2',opened.leaseId),e=>e.code==='REQUEST_UNKNOWN');
  f.service.close(s.id,opened.leaseId);
 }finally{f.close();}
});
test('HTTP endpoints enforce scope, unknown fields, idempotency, conditional writes and non-caching responses',async()=>{
 const f=fixture();try{
  const {createWorkspaceApi}=require('../src/shared/protocol/workspace-api.server.ts'),handle=createWorkspaceApi(f.service);
  async function call(method,segments,body,headers={}){const response=await handle(new Request('http://localhost/api/workspaces/'+segments.join('/'),{method,headers:{'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),segments);assert.equal(response.headers.get('cache-control'),'no-store');return {status:response.status,payload:response.status===204?null:await response.json()};}
  const body={name:'Work',projects:[{rootPath:f.a}],defaultProjectIndex:0};
  assert.equal((await call('POST',[],body)).status,428);
  const created=await call('POST',[],body,{'idempotency-key':'w'});assert.equal(created.status,201);const w=created.payload.data;
  assert.equal((await call('PUT',[w.id],body,{'if-match':'stale'})).status,409);
  assert.equal((await call('POST',[w.id,'sessions'],{projectId:'standalone'},{'idempotency-key':'s'})).status,400);
  const session=await call('POST',[w.id,'sessions'],{}, {'idempotency-key':'s'});assert.equal(session.status,201);const sid=session.payload.data.id;assert.equal('nativeRef' in session.payload.data,false);
  assert.equal((await call('GET',['another','sessions',sid])).status,404);
  assert.equal((await call('POST',[w.id,'sessions',sid,'runtime','open'],{agentId:'forbidden'})).status,400);
  const opened=await call('POST',[w.id,'sessions',sid,'runtime','open']);assert.equal(opened.status,200);
  const lease=opened.payload.data.leaseId;
  assert.equal((await call('POST',[w.id,'sessions',sid,'messages'],{content:'hello'},{'idempotency-key':'m'})).status,409);
  const accepted=await call('POST',[w.id,'sessions',sid,'messages'],{content:'hello'},{'idempotency-key':'m','x-session-lease-id':lease});assert.equal(accepted.status,202);f.finish();await tick();
  for(const action of ['memory','memory/context','memory/summarize','unknown']) {
    assert.equal((await call('GET',[w.id,'sessions',sid,...action.split('/')])).status,404);
    assert.equal((await call('PATCH',[w.id,'sessions',sid,...action.split('/')],{})).status,404);
  }
  f.service.close(sid,lease);
 }finally{f.close();}
});
test('workspace service opens exactly one Pi per session, checks lease, retains background execution and request evidence',async()=>{const f=fixture();try{
 const w=await f.service.save(null,{name:'Work',projects:[{rootPath:f.a},{rootPath:f.b}],defaultProjectIndex:1},'w');const s=f.service.createSession(w.id,{},'s');
 const leases=await Promise.all([f.service.open(w.id,s.id),f.service.open(w.id,s.id)]);assert.equal(f.inputs.length,1);assert.equal(f.inputs[0].workingDirectory,require('node:fs').realpathSync(f.b));assert.equal(f.inputs[0].session.agentSnapshot,null);assert.equal(f.inputs[0].workspace.projects.length,2);
 await assert.rejects(f.service.accept(w.id,s.id,{content:'x'},'msg','wrong'),e=>e.code==='RUNTIME_NOT_OPEN');
 const accepted=await f.service.accept(w.id,s.id,{content:'  original text  '},'msg',leases[0].leaseId);assert.equal(accepted.accepted,true);assert.equal(f.sent[0].text,'  original text  ');
 await assert.rejects(f.service.accept(w.id,s.id,{content:'other'},'other',leases[0].leaseId),e=>e.code==='SESSION_BUSY');
 f.service.close(s.id,leases[0].leaseId);f.service.close(s.id,leases[1].leaseId);assert.equal(f.handles.has(s.id),true);
 f.finish();await tick();assert.equal(f.persisted.get(s.id).at(-1).type,'workspace_request_result');
 const opened=await f.service.open(w.id,s.id);await f.service.accept(w.id,s.id,{content:'  original text  '},'msg',opened.leaseId);assert.equal(f.sent.length,1);
 await assert.rejects(f.service.accept(w.id,s.id,{content:'changed'},'msg',opened.leaseId),e=>e.code==='IDEMPOTENCY_CONFLICT');f.service.close(s.id,opened.leaseId);
 }finally{f.close();}});
test('unknown persisted evidence blocks writes and configuration; explicit acknowledgement never replays prompt',async()=>{const f=fixture();try{
 const w=await f.service.save(null,{name:'Work',projects:[{rootPath:f.a}],defaultProjectIndex:0},'w');const s=f.service.createSession(w.id,{},'s');const opened=await f.service.open(w.id,s.id);const handle=f.handles.get(s.id);f.runtime.requestEntry(handle,'workspace_request',{key:'uncertain',hash:'hash'});
 await assert.rejects(f.service.accept(w.id,s.id,{content:'new'},'new',opened.leaseId),e=>e.code==='REQUEST_UNKNOWN');
 await assert.rejects(f.service.save(w.id,{name:'Other',projects:w.projects.map(p=>({id:p.id,rootPath:p.rootPath})),defaultProjectIndex:0},w.writeETag),e=>e.code==='REQUEST_UNKNOWN');
 assert.equal((await f.service.recover(w.id,s.id,'inspect')).pending.length,1);await f.service.recover(w.id,s.id,'acknowledge-unknown');assert.equal((await f.service.recover(w.id,s.id,'inspect')).pending.length,0);assert.equal(f.sent.length,0);
 assert.throws(()=>f.service.session('another',s.id),e=>e.code==='NOT_FOUND');f.service.close(s.id,opened.leaseId);
 }finally{f.close();}});
