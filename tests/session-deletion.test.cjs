require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {fixture}=require('./workspace-fixture.cjs');
const {deleteSessionRecord}=require('../src/infrastructure/database/delete-session.server.ts');
const {createSessionExecutionService}=require('../src/application/session-execution-service.ts');
const {sessionLocks,releaseSession}=require('../src/application/session-lock.ts');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function projectFixture(f){
 f.db.prepare("INSERT INTO projects VALUES('p','P',NULL,'code',?,'active','now','now')").run(f.a);
 const values=new Map();
 function add(id,state='idle'){
  f.db.prepare("INSERT INTO sessions(id,project_id,purpose,created_at,updated_at) VALUES(?,'p','test','now','now')").run(id);
  const value={id,projectId:'p',state,agentSnapshot:null,mcpIds:[],nativeRef:null};values.set(id,value);return value;
 }
 let closeAction=async()=>{};
 const handle={},runtime={getHandle:()=>handle,isBusy:()=>false,close:()=>closeAction()};
 const project={id:'p',rootPath:f.a,status:'disabled'};
 const service=createSessionExecutionService({sessions:{get:id=>values.get(id),updateRuntime(id,patch){Object.assign(values.get(id),patch);return values.get(id);},delete(owner,id){deleteSessionRecord(f.db,'project',owner,id);values.delete(id);}},projects:{get:()=>project},catalog:{},runtime});
 return {add,values,service,runtime,project,setClose:value=>{closeAction=value;}};
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
test('workspace DELETE interrupts live requests, accepts unknown evidence and waits for compaction and close',async()=>{
 const f=fixture();try{
  const w=await f.service.save(null,{name:'Work',projects:[{rootPath:f.a}],defaultProjectIndex:0},'w');
  const s=f.service.createSession(w.id,{},'s'),lease=await f.service.open(w.id,s.id);
  await f.service.accept(w.id,s.id,{content:'work'},'request',lease.leaseId);
  let interrupted=0;f.runtime.interrupt=async()=>{interrupted++;f.finish();};
  await f.service.deleteSession(w.id,s.id);assert.equal(interrupted,1);assert.equal(f.repository.session(w.id,s.id),null);
  const unknown=f.service.createSession(w.id,{},'unknown');await f.service.open(w.id,unknown.id);
  f.runtime.requestEntry(f.handles.get(unknown.id),'workspace_request',{key:'unknown',hash:'x'});
  f.runtime.requestEntries=()=>{throw Error('corrupt journal');};
  await f.service.deleteSession(w.id,unknown.id);assert.equal(f.repository.session(w.id,unknown.id),null);
  f.runtime.requestEntries=h=>f.persisted.get(h.id)??[];
  const compact=f.service.createSession(w.id,{},'compact');await f.service.open(w.id,compact.id);
  let finishCompact,cancelled=0;f.runtime.compact=()=>new Promise(resolve=>{finishCompact=resolve;});
  f.runtime.cancelCompaction=()=>{cancelled++;};
  await f.service.compact(w.id,compact.id);
  let finishClose,closed=0;f.runtime.close=()=>{closed++;return new Promise(resolve=>{finishClose=resolve;});};
  let completed=false;const deletion=f.service.deleteSession(w.id,compact.id).then(value=>{completed=true;return value;});await tick();
  assert.equal(cancelled,1);assert.equal(completed,false);assert(f.repository.session(w.id,compact.id));assert.equal(closed,0);
  await assert.rejects(f.service.open(w.id,compact.id),e=>e.code==='SESSION_BUSY');
  await assert.rejects(f.service.accept(w.id,compact.id,{content:'late'},'late','lease'),e=>e.code==='SESSION_BUSY');
  await assert.rejects(f.service.recover(w.id,compact.id,'acknowledge-unknown'),e=>e.code==='SESSION_BUSY');
  const duplicate=f.service.deleteSession(w.id,compact.id);
  finishCompact();await tick();assert.equal(closed,1);assert.equal(completed,false);
  finishClose();assert.deepEqual(await deletion,await duplicate);assert.equal(completed,true);assert.equal(f.repository.session(w.id,compact.id),null);
 }finally{f.close();}
});
test('workspace DELETE waits for in-flight initialization and blocks new operations',async()=>{
 const f=fixture();try{
  const w=await f.service.save(null,{name:'Work',projects:[{rootPath:f.a}],defaultProjectIndex:0},'opening-w');
  const s=f.service.createSession(w.id,{},'opening-s');
  const initialize=f.runtime.initializeProject;let enter,finish;
  const entered=new Promise(resolve=>{enter=resolve;});
  f.runtime.initializeProject=async(...args)=>{enter();await new Promise(resolve=>{finish=resolve;});return initialize(...args);};
  const opening=f.service.open(w.id,s.id);const rejected=assert.rejects(opening,e=>e.code==='SESSION_BUSY');await entered;
  let done=false;const deletion=f.service.deleteSession(w.id,s.id).then(result=>{done=true;return result;});await tick();
  assert.equal(done,false);assert(f.repository.session(w.id,s.id));
  await assert.rejects(f.service.open(w.id,s.id),e=>e.code==='SESSION_BUSY');
  finish();await rejected;await deletion;assert.equal(f.handles.has(s.id),false);assert.equal(f.repository.session(w.id,s.id),null);
 }finally{f.close();}
});
test('project DELETE cancels a running message and waits for its completion callback before SQL deletion',async()=>{
 const f=fixture();try{
  const p=projectFixture(f);p.add('live');p.project.status='active';
  let finishSend,stopped=false,recordPresentAtSettlement=false;
  p.runtime.send=()=>new Promise(resolve=>{finishSend=resolve;});
  p.runtime.stopForDeletion=async()=>{stopped=true;};
  p.service.accept('live','work',undefined,()=>{recordPresentAtSettlement=p.values.has('live');});await tick();
  let done=false;const deletion=p.service.deleteSession('p','live').then(result=>{done=true;return result;});await tick();
  assert.equal(stopped,true);assert.equal(done,false);assert(p.values.has('live'));
  assert.throws(()=>p.service.accept('live','late'),e=>e.code==='SESSION_BUSY');
  finishSend();await deletion;assert.equal(recordPresentAtSettlement,true);assert.equal(p.values.has('live'),false);
 }finally{f.close();}
});
test('project DELETE cancels native compaction and waits for its service to release the lock',async()=>{
 const f=fixture();try{
  const p=projectFixture(f);p.add('compacting');p.project.status='active';p.values.get('compacting').nativeRef={sessionId:'compacting'};
  let failCompact,cancelled=false;
  p.runtime.inspect=async()=>({canCompact:true});
  p.runtime.compact=()=>new Promise((resolve,reject)=>{failCompact=reject;});
  p.runtime.stopForDeletion=async()=>{cancelled=true;};
  const {createNativeContextService}=require('../src/application/native-context-service.ts');
  const context=createNativeContextService({sessions:{get:id=>p.values.get(id)},projects:{get:()=>p.project},runtime:p.runtime,assertWritable(){}});
  await context.compact('p','compacting','compact-key');
  let done=false;const deletion=p.service.deleteSession('p','compacting').then(()=>{done=true;});await tick();
  assert.equal(cancelled,true);assert.equal(done,false);assert(sessionLocks.has('compacting'));
  failCompact(Error('cancelled'));await deletion;assert.equal(sessionLocks.has('compacting'),false);assert.equal(p.values.has('compacting'),false);
 }finally{f.close();}
});
test('workspace deletion leaves session rows on runtime-close failure',async()=>{
 const f=fixture();try{const w=await f.service.save(null,{name:'Work',projects:[{rootPath:f.a}],defaultProjectIndex:0},'w'),s=f.service.createSession(w.id,{},'s');await f.service.open(w.id,s.id);f.runtime.close=async()=>{throw Error('cannot close');};await assert.rejects(f.service.deleteSession(w.id,s.id),/cannot close/);assert(f.repository.session(w.id,s.id));}finally{f.close();}
});
test('project deletion API bypasses corrupt operation journals and remains allowed while unavailable',async()=>{
 const f=fixture();try{
  const p=projectFixture(f);p.add('unknown','unavailable');
  const {createSessionToolsService}=require('../src/application/session-tools-service.ts');
  const {createProjectSessionService}=require('../src/application/project-session-service.ts');
  const dependencies={sessions:{get:id=>p.values.get(id)},projects:{get:()=>p.project},operations:{list(){throw Error('corrupt journal');}}};
  const metadata=createProjectSessionService({...dependencies,writable:()=>true});
  assert.equal(metadata.summary('p','unknown').allowedActions.delete.allowed,true);
  const tools=createSessionToolsService({...dependencies,runtime:p.runtime,execution:p.service,assertWritable(){},present:metadata.present,catalog:{}});
  assert.deepEqual(await tools.delete('p','unknown'),{deleted:true,sessionId:'unknown'});
 }finally{f.close();}
});
test('project DELETE closes a handle replaced by an operation that was already in flight',async()=>{
 const f=fixture();try{
  const p=projectFixture(f);p.add('replacing');const oldHandle={},newHandle={},stopped=[];let current=oldHandle,closed;
  p.runtime.getHandle=()=>current;p.runtime.stopForDeletion=async handle=>{stopped.push(handle);};p.runtime.close=async handle=>{closed=handle;};
  sessionLocks.add('replacing');const deletion=p.service.deleteSession('p','replacing');await tick();
  assert.deepEqual(stopped,[oldHandle]);current=newHandle;releaseSession('replacing');await deletion;
  assert.deepEqual(stopped,[oldHandle,newHandle]);assert.equal(closed,newHandle);
 }finally{releaseSession('replacing');f.close();}
});
test('workspace DELETE reports stop failure without losing its row and can be retried',async()=>{
 const f=fixture();try{
  const w=await f.service.save(null,{name:'Work',projects:[{rootPath:f.a}],defaultProjectIndex:0},'stop-w'),s=f.service.createSession(w.id,{},'stop-s');await f.service.open(w.id,s.id);
  f.runtime.stopForDeletion=async()=>{throw Error('stop failed');};
  await assert.rejects(f.service.deleteSession(w.id,s.id),/stop failed/);assert(f.repository.session(w.id,s.id));
  assert.equal(f.service.session(w.id,s.id).id,s.id);
  f.runtime.stopForDeletion=async()=>{};await f.service.deleteSession(w.id,s.id);assert.equal(f.repository.session(w.id,s.id),null);
 }finally{f.close();}
});
test('repository deletion rolls back when historical session references remain',async()=>{
 const f=fixture();try{const p=projectFixture(f);p.add('s');const w=await f.service.save(null,{name:'Work',projects:[{rootPath:f.a}],defaultProjectIndex:0},'w'),s=f.service.createSession(w.id,{},'s');
 f.db.exec('CREATE TABLE retained_project_session(id TEXT REFERENCES sessions(id) ON DELETE RESTRICT);CREATE TABLE retained_workspace_session(id TEXT REFERENCES workspace_sessions(id) ON DELETE RESTRICT)');
 for(const [kind,owner,id,reference] of [['project','p','s','retained_project_session'],['workspace',w.id,s.id,'retained_workspace_session']]){f.db.prepare('INSERT INTO '+reference+' VALUES(?)').run(id);assert.throws(()=>deleteSessionRecord(f.db,kind,owner,id),e=>e.code==='SESSION_REFERENCED');assert(f.db.prepare('SELECT 1 FROM '+(kind==='project'?'sessions':'workspace_sessions')+' WHERE id=?').get(id));}
 }finally{f.close();}
});
test('project DELETE accepts unavailable state, drains locks, blocks reopening, and reports close failures',async()=>{
 const f=fixture();try{
  const p=projectFixture(f);p.add('s');p.add('other','ended');
  await assert.rejects(p.service.deleteSession('wrong','s'),e=>e.code==='NOT_FOUND');
  for(const state of ['starting','running','interrupting','unavailable']){p.add(state,state);await p.service.deleteSession('p',state);assert(!p.values.has(state));}
  p.add('locked');sessionLocks.add('locked');let lockedDone=false;
  const lockedDeletion=p.service.deleteSession('p','locked').then(()=>{lockedDone=true;});await tick();
  assert.equal(lockedDone,false);assert(p.values.has('locked'));await assert.rejects(p.service.open('locked','new-open'),e=>e.code==='SESSION_BUSY');
  releaseSession('locked');await lockedDeletion;assert.equal(lockedDone,true);
  p.setClose(async()=>{throw Error('cannot close');});await assert.rejects(p.service.deleteSession('p','s'),/cannot close/);assert(f.db.prepare("SELECT 1 FROM sessions WHERE id='s'").get());assert(!sessionLocks.has('s'));
  let finishClose;p.setClose(()=>new Promise(resolve=>{finishClose=resolve;}));const deletion=p.service.deleteSession('p','other');
  await assert.rejects(p.service.open('other','open'),e=>e.code==='SESSION_BUSY');await tick();finishClose();await deletion;
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
