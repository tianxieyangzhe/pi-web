require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Database=require('better-sqlite3');
const {createSessionRepository}=require('../src/infrastructure/database/session-repository.ts');
const {createProjectSessionService}=require('../src/application/project-session-service.ts');
const {createProjectOperationStore}=require('../src/infrastructure/projects/operation-journal.server.ts');
const {createdSessionId}=require('../src/domain/project-operations.ts');
const os=require('node:os');
function database(){const db=new Database(':memory:');db.pragma('foreign_keys=ON');for(const name of ['core-schema.sql','bot-schema.sql','agent-binding-schema.sql','role-schema.sql','workspace-schema.sql'])db.exec(fs.readFileSync(path.join(__dirname,'../src/infrastructure/database',name),'utf8'));db.prepare("INSERT INTO projects(id,name,kind,root_path,status,created_at,updated_at) VALUES('p','project','code','/tmp','active','now','now')").run();return db;}
test('target Schema has no memory/state copies; native identity and creation keys cannot mutate; ended_at remains immutable historical data',()=>{
 const db=database(),repository=createSessionRepository(db);try{
  assert(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='session_memories'").get());const columns=db.prepare('PRAGMA table_info(sessions)').all().map(c=>c.name);assert(!columns.some(name=>['session_memory_id','state','status'].includes(name)));
  const one=repository.create({projectId:'p',purpose:'goal',agentId:null,agentSnapshot:null,stableId:'s1',createRequestKeyHash:'a'.repeat(64),createRequestSha256:'b'.repeat(64)});assert.equal(one.state,'not_started');assert.equal(one.endedAt,null);
  repository.updateRuntime('s1',{state:'running'});assert.equal(repository.get('s1').state,'running');assert.equal(createSessionRepository(db).get('s1').state,'not_started');
  const ref={kind:'pi',sessionId:'n1',sessionFile:'/tmp/one.jsonl',cwd:'/tmp'};repository.setNativeRefIfAbsent('s1',ref);assert.throws(()=>repository.setNativeRefIfAbsent('s1',{...ref,sessionId:'other'}),e=>e.code==='REQUEST_UNKNOWN');
  assert.throws(()=>db.prepare('UPDATE sessions SET native_ref_json=? WHERE id=?').run(JSON.stringify({...ref,sessionId:'other'}),'s1'),/immutable/);
  repository.create({projectId:'p',purpose:'',agentId:null,agentSnapshot:null,stableId:'s2'});assert.throws(()=>repository.setNativeRefIfAbsent('s2',ref),/UNIQUE/);assert.throws(()=>db.prepare("UPDATE sessions SET create_request_key_hash=? WHERE id='s1'").run('c'.repeat(64)),/immutable/);
  repository.updateRuntime('s1',{endedAt:'2026-01-01T00:00:00.000Z'});assert.equal(repository.get('s1').status,'closed');assert.throws(()=>db.prepare("UPDATE sessions SET ended_at=NULL WHERE id='s1'").run(),/immutable/);
 }finally{db.close();}
});
test('create uses durable stable identity; DTO omits native paths and retired fields; invalid payloads cannot reuse a key',()=>{
 const db=database(),root=fs.mkdtempSync(path.join(os.tmpdir(),'project-model-')),sessions=createSessionRepository(db),operations=createProjectOperationStore(root);const service=createProjectSessionService({sessions,operations,projects:{get:()=>({id:'p',status:'active'})},catalog:{},assertWritable(){},deleteSession(){}});
 try{const created=service.create('p',{purpose:'  work  '},'create');assert.equal(created.id,createdSessionId('p','create'));assert.equal(created.purpose,'work');assert.equal(service.create('p',{purpose:'work'},'create').id,created.id);assert.equal(sessions.listForProject('p').length,1);
  const etag=created.writeETag;sessions.setNativeRefIfAbsent(created.id,{kind:'pi',sessionId:'native',sessionFile:'/secret/one',cwd:'/tmp'});const dto=service.summary('p',created.id);assert.notEqual(dto.writeETag,etag);assert.equal(dto.status,'closed');for(const key of ['nativeRef','nativeMetadata','sessionMemoryId','createRequestKeyHash'])assert(!Object.hasOwn(dto,key));assert.equal(JSON.stringify(dto).includes('/secret'),false);
  const before=service.present(sessions.get(created.id)).writeETag;sessions.updateRuntime(created.id,{state:'running'});assert.equal(service.present(sessions.get(created.id)).writeETag,before);
  assert.throws(()=>service.create('p',{purpose:'new'},'create'),e=>e.code==='IDEMPOTENCY_CONFLICT');assert.throws(()=>service.create('p',{sessionMemoryId:'old'},'x'),e=>e.code==='INVALID_INPUT');assert.throws(()=>service.create('p',{purpose:'x'},undefined),e=>e.code==='INVALID_IDEMPOTENCY_KEY');assert.throws(()=>service.create('p',{purpose:'x'.repeat(2001)},'long'),e=>e.code==='INVALID_INPUT');
 }finally{db.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('uncommitted create stays unknown after restart; explicit acknowledge never rebuilds; close retries preserve the row without lifecycle writes',async()=>{
 const db=database(),root=fs.mkdtempSync(path.join(os.tmpdir(),'create-recovery-')),repository=createSessionRepository(db),operations=createProjectOperationStore(root);const projects={get:()=>({id:'p',status:'active',rootPath:'/tmp'})};let fail=true,closeCount=0;
 const sessions={...repository,create(input){if(fail)throw Error('SQL failed');return repository.create(input);}};
 const service=createProjectSessionService({sessions,operations,projects,releaseHandle:async()=>{closeCount++;}});
 try{
 let operationId;assert.throws(()=>service.create('p',{purpose:'create'},'lost'),e=>{operationId=e.operationId;return e.code==='REQUEST_UNKNOWN';});assert.equal(repository.listForProject('p').length,0);fail=false;assert.throws(()=>service.create('p',{purpose:'create'},'lost'),e=>e.code==='REQUEST_UNKNOWN');assert.equal(repository.listForProject('p').length,0);
 const {createSessionToolsService}=require('../src/application/session-tools-service.ts');const tools=createSessionToolsService({sessions,operations,projects,runtime:{},execution:{},assertWritable(){},present:service.present,catalog:{}});
 assert.equal((await tools.recoverCreate('p',operationId,{operationId,action:'inspect'})).status,'unknown');assert.equal((await tools.recoverCreate('p',operationId,{operationId,action:'acknowledge-unknown'},'ack')).status,'acknowledged');assert.throws(()=>service.create('p',{purpose:'create'},'lost'),e=>e.code==='REQUEST_UNKNOWN');
 const created=service.create('p',{purpose:'new'},'next');const ended=await service.end('p',created.id,'end');const again=await service.end('p',created.id,'end');const different=await service.end('p',created.id,'other-end');assert.equal(ended.status,'closed');assert.equal(again.status,'closed');assert.equal(different.status,'closed');assert(!('endedAt' in ended));assert.equal(repository.get(created.id).endedAt,null);assert.equal(closeCount,3);assert.equal(repository.listForProject('p').length,1);
 }finally{db.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('independent binding rejects an existing Workspace native identity; incomplete key pairs fail target SQL checks',()=>{
 const db=database(),repository=createSessionRepository(db),{createWorkspaceRepository}=require('../src/infrastructure/database/workspace-repository.ts');
 try{const workspace=createWorkspaceRepository(db),w=workspace.save(null,{name:'W',projects:[{rootPath:'/tmp'}],defaultProjectIndex:0},'w'),s=workspace.createSession(w.id,w.defaultProjectId,'','ws');const ref={kind:'pi',sessionId:'workspace-native',sessionFile:'/tmp/workspace.jsonl',cwd:'/tmp'};workspace.bindNative(w.id,s.id,ref);repository.create({projectId:'p',purpose:'',agentId:null,agentSnapshot:null,stableId:'independent'});assert.throws(()=>repository.setNativeRefIfAbsent('independent',ref),e=>e.code==='REQUEST_UNKNOWN');assert.equal(repository.get('independent').nativeRef,null);assert.throws(()=>repository.create({projectId:'p',purpose:'',agentId:null,agentSnapshot:null,stableId:'invalid-key',createRequestSha256:'a'.repeat(64)}),/CHECK/);assert.equal(repository.get('invalid-key'),null);
 }finally{db.close();}
});
