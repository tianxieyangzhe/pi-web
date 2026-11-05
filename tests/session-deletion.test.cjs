require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {fixture}=require('./workspace-fixture.cjs');
const {deleteSessionRecord}=require('../src/infrastructure/database/delete-session.server.ts');
const {createSessionExecutionService}=require('../src/application/session-execution-service.ts');
const {sessionLocks}=require('../src/application/session-lock.ts');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function projectFixture(f){
 f.db.prepare("INSERT INTO projects VALUES('p','P',NULL,'code',?,'active','now','now')").run(f.a);
 const values=new Map();
 function add(id,state='idle'){
  f.db.prepare("INSERT INTO sessions(id,project_id,purpose,created_at,updated_at) VALUES(?,'p','test','now','now')").run(id);
  const value={id,projectId:'p',state,agentSnapshot:null,mcpIds:[],nativeRef:null};values.set(id,value);return value;
 }
 let closeAction=async()=>{};
 const runtime={getHandle:()=>({}),isBusy:()=>false,close:()=>closeAction()};
 const service=createSessionExecutionService({sessions:{get:id=>values.get(id),delete(owner,id){deleteSessionRecord(f.db,'project',owner,id);values.delete(id);}},projects:{get:()=>({id:'p',rootPath:f.a,status:'disabled'})},catalog:{},runtime});
 return {add,values,service,setClose:value=>{closeAction=value;}};
}
test('Next workspace route exports DELETE and forwards owner/session to the application API',async()=>{
 const f=fixture();try{
  const w=await f.service.save(null,{name:'Work',projects:[{rootPath:f.a}],defaultProjectIndex:0},'route-w'),s=f.service.createSession(w.id,{},'route-s');
  const original=Module._load;let route;
  Module._load=function(name,...args){if(name==='@/bootstrap/workspace.server')return {workspaceServices:f.service};return original.call(this,name,...args);};
  try{route=require('../src/app/api/workspaces/[[...segments]]/route.ts');}finally{Module._load=original;}
  assert.equal(typeof route.DELETE,'function');
  const response=await route.DELETE(new Request(`http://localhost/api/workspaces/${w.id}/sessions/${s.id}`,{method:'DELETE'}),{params:Promise.resolve({segments:[w.id,'sessions',s.id]})});
  assert.equal(response.status,200);assert.deepEqual((await response.json()).data,{deleted:true,sessionId:s.id});
  assert.equal(f.repository.session(w.id,s.id),null);
 }finally{f.close();}
});
test('workspace DELETE enforces scope and removes exactly session metadata, preserving native/project files',async()=>{
 const f=fixture();try{
  const {createWorkspaceApi}=require('../src/shared/protocol/workspace-api.server.ts'),handle=createWorkspaceApi(f.service);
  const w=await f.service.save(null,{name:'Work',projects:[{rootPath:f.a}],defaultProjectIndex:0},'w');
  const s=f.service.createSession(w.id,{},'s'),other=f.service.createSession(w.id,{},'other');
  const value=f.repository.session(w.id,s.id),lease=await f.service.open(w.id,s.id);
  const file=f.repository.session(w.id,s.id).nativeRef.sessionFile;fs.writeFileSync(file,'native history');fs.writeFileSync(file+'.workspace-requests.jsonl','journal');fs.writeFileSync(path.join(f.a,'keep'),'project');
  const call=async(owner,id,body)=>handle(new Request('http://localhost/api/workspaces/'+owner+'/sessions/'+id,{method:'DELETE',...(body===undefined?{}:{body:JSON.stringify(body)})}),[owner,'sessions',id]);
  assert.equal((await call('wrong',s.id)).status,404);
  assert.equal((await call(w.id,s.id,{force:true})).status,400);
  const response=await call(w.id,s.id);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual((await response.json()).data,{deleted:true,sessionId:s.id});
  assert.equal(f.repository.session(w.id,s.id),null);assert.equal(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='session_memories'").get(),undefined);
  assert.equal(f.repository.sessions(w.id)[0].id,other.id);assert(f.repository.get(w.id));assert.equal(f.handles.has(s.id),false);
  assert.throws(()=>f.service.assertLease(s.id,lease.leaseId),e=>e.code==='RUNTIME_NOT_OPEN');
  assert.equal(fs.readFileSync(file,'utf8'),'native history');assert.equal(fs.readFileSync(file+'.workspace-requests.jsonl','utf8'),'journal');assert.equal(fs.readFileSync(path.join(f.a,'keep'),'utf8'),'project');
  assert.equal((await call(w.id,s.id)).status,404);
  assert.equal((await call(w.id,other.id)).status,200,'empty session can be deleted without opening Pi');
  const ended=f.service.createSession(w.id,{},'ended');await f.service.end(w.id,ended.id);
  assert.equal((await call(w.id,ended.id)).status,200,'ended session can be deleted without a native file');
 }finally{f.close();}
});
test('workspace deletion rejects live requests, unknown evidence, compaction and concurrent reopening',async()=>{
 const f=fixture();try{
  const w=await f.service.save(null,{name:'Work',projects:[{rootPath:f.a}],defaultProjectIndex:0},'w');
  const s=f.service.createSession(w.id,{},'s'),lease=await f.service.open(w.id,s.id);
  await f.service.accept(w.id,s.id,{content:'work'},'request',lease.leaseId);
  await assert.rejects(f.service.deleteSession(w.id,s.id),e=>e.code==='SESSION_BUSY');f.finish();await tick();
  f.runtime.requestEntry(f.handles.get(s.id),'workspace_request',{key:'unknown',hash:'x'});
  await assert.rejects(f.service.deleteSession(w.id,s.id),e=>e.code==='REQUEST_UNKNOWN');
  await f.service.recover(w.id,s.id,'acknowledge-unknown');
  let finishCompact;f.runtime.compact=()=>new Promise(resolve=>{finishCompact=resolve;});
  await f.service.compact(w.id,s.id);await assert.rejects(f.service.deleteSession(w.id,s.id),e=>e.code==='SESSION_BUSY');finishCompact();await tick();
  let finishClose;f.runtime.close=()=>new Promise(resolve=>{finishClose=resolve;});
  const deletion=f.service.deleteSession(w.id,s.id);await tick();
  await assert.rejects(f.service.open(w.id,s.id),e=>e.code==='SESSION_BUSY');
  await assert.rejects(f.service.deleteSession(w.id,s.id),e=>e.code==='SESSION_BUSY');
  finishClose();await deletion;
 }finally{f.close();}
});
test('workspace deletion leaves session rows on runtime-close failure',async()=>{
 const f=fixture();try{const w=await f.service.save(null,{name:'Work',projects:[{rootPath:f.a}],defaultProjectIndex:0},'w'),s=f.service.createSession(w.id,{},'s');await f.service.open(w.id,s.id);f.runtime.close=async()=>{throw Error('cannot close');};await assert.rejects(f.service.deleteSession(w.id,s.id),/cannot close/);assert(f.repository.session(w.id,s.id));}finally{f.close();}
});
test('repository deletion rolls back when historical session references remain',async()=>{
 const f=fixture();try{const p=projectFixture(f);p.add('s');const w=await f.service.save(null,{name:'Work',projects:[{rootPath:f.a}],defaultProjectIndex:0},'w'),s=f.service.createSession(w.id,{},'s');
 f.db.exec('CREATE TABLE retained_project_session(id TEXT REFERENCES sessions(id) ON DELETE RESTRICT);CREATE TABLE retained_workspace_session(id TEXT REFERENCES workspace_sessions(id) ON DELETE RESTRICT)');
 for(const [kind,owner,id,reference] of [['project','p','s','retained_project_session'],['workspace',w.id,s.id,'retained_workspace_session']]){f.db.prepare('INSERT INTO '+reference+' VALUES(?)').run(id);assert.throws(()=>deleteSessionRecord(f.db,kind,owner,id),e=>e.code==='SESSION_REFERENCED');assert(f.db.prepare('SELECT 1 FROM '+(kind==='project'?'sessions':'workspace_sessions')+' WHERE id=?').get(id));}
 }finally{f.close();}
});
test('project deletion guards scope, running/unknown/locks and close failures; route returns safe DTO',async()=>{
 const f=fixture();try{
  const p=projectFixture(f);p.add('s');p.add('other','ended');
  await assert.rejects(p.service.deleteSession('wrong','s'),e=>e.code==='NOT_FOUND');
  for(const state of ['starting','running','interrupting','unavailable']){p.values.get('s').state=state;await assert.rejects(p.service.deleteSession('p','s'),e=>e.code===(state==='unavailable'?'REQUEST_UNKNOWN':'SESSION_BUSY'));}
  p.values.get('s').state='idle';
  sessionLocks.add('s');await assert.rejects(p.service.deleteSession('p','s'),e=>e.code==='SESSION_BUSY');sessionLocks.delete('s');
  p.setClose(async()=>{throw Error('cannot close');});await assert.rejects(p.service.deleteSession('p','s'),/cannot close/);assert(f.db.prepare("SELECT 1 FROM sessions WHERE id='s'").get());assert(!sessionLocks.has('s'));
  let finishClose;p.setClose(()=>new Promise(resolve=>{finishClose=resolve;}));const deletion=p.service.deleteSession('p','other');
  await assert.rejects(p.service.open('other','open'),e=>e.code==='SESSION_BUSY');finishClose();await deletion;
  p.setClose(async()=>{});
  const original=Module._load;let route;
  Module._load=function(name,...args){if(name==='@/bootstrap/composition-root.server')return {services:{sessionTools:{delete:(owner,id)=>p.service.deleteSession(owner,id)}}};return original.call(this,name,...args);};
  try{route=require('../src/app/api/projects/[projectId]/sessions/[sessionId]/route.ts');}finally{Module._load=original;}
  const context={params:Promise.resolve({projectId:'p',sessionId:'s'})};
  const response=await route.DELETE(new Request('http://localhost/api/projects/p/sessions/s',{method:'DELETE'}),context);
  assert.equal(response.status,200);assert.deepEqual((await response.json()).data,{deleted:true,sessionId:'s'});
  assert.equal(f.db.prepare("SELECT 1 FROM sessions WHERE id='s'").get(),undefined);assert.equal(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='session_memories'").get(),undefined);
  assert.equal((await route.DELETE(new Request('http://localhost/api/projects/p/sessions/s',{method:'DELETE'}),context)).status,404);
 }finally{sessionLocks.delete('s');f.close();}
});
