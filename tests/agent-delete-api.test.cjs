require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
const Database=require('better-sqlite3');
const {targetSchema}=require('../src/infrastructure/database/schema.server.ts');
const {createAgentRepository}=require('../src/infrastructure/database/agent-repository.ts');
const {createSessionAssistantStore}=require('../src/infrastructure/agents/session-assistant-store.server.ts');
const {createCatalogService}=require('../src/application/catalog-service.ts');
const {createSessionAssistantAccess}=require('../src/application/session-assistant-service.ts');
const {roleETag}=require('../src/domain/agent-definition.ts');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-delete-api-')),previous=process.env.AI_WORKSPACE_AGENT_DIR;
 process.env.AI_WORKSPACE_AGENT_DIR=path.join(root,'agents');
 const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec(targetSchema);
 const agents=createAgentRepository(db),store=createSessionAssistantStore(path.join(root,'selections'));
 const catalog=createCatalogService({agents,projects:{},mcps:{},normalizeProjectRoot:p=>p});
 const assistants=createSessionAssistantAccess(store,(id,revision,hash)=>agents.getVersion(id,revision,hash));
 const entry=require.resolve('../src/app/api/agents/[agentId]/route.ts'),original=Module._load;let route;
 delete require.cache[entry];Module._load=function(name,...args){if(name==='@/bootstrap/composition-root.server')return {services:{catalog}};return original.call(this,name,...args);};
 try{route=require(entry);}finally{Module._load=original;delete require.cache[entry];}
 const create=()=>catalog.createAgent({name:'助手',kind:'project',definition:{format:4,scope:'global',source:null,systemPromptMode:'replace',systemPrompt:'Keep this historical prompt'}});
 return {root,db,agents,store,assistants,catalog,create,async remove(agent,etag=roleETag(agent)){
  const response=await route.DELETE(new Request('http://localhost/api/agents/'+agent.id,{method:'DELETE',headers:etag?{'if-match':etag}:{}}),{params:Promise.resolve({agentId:agent.id})});
  return {status:response.status,body:await response.json()};
 },close(){db.close();fs.rmSync(root,{recursive:true,force:true});if(previous===undefined)delete process.env.AI_WORKSPACE_AGENT_DIR;else process.env.AI_WORKSPACE_AGENT_DIR=previous;}};
}
test('DELETE agent API physically removes active, disabled and historical archived entries, preserving version files',async()=>{
 const f=fixture();try{
  for(const status of ['active','disabled','archived']){
   let a=f.create();if(status!=='active')a=f.catalog.updateAgent(a.id,{status,writeETag:roleETag(a)});
   const file=path.join(f.root,'agents',a.id,'1','definition.json'),bytes=fs.readFileSync(file);
   const result=await f.remove(a);assert.equal(result.status,200);assert.deepEqual(result.body.data,{deleted:true});
   assert.equal(f.db.prepare('SELECT * FROM agents WHERE id=?').get(a.id),undefined);assert.equal(f.catalog.listAgents().some(v=>v.id===a.id),false);assert.deepEqual(fs.readFileSync(file),bytes);
   assert.equal((await f.remove(a)).status,404);
  }
 }finally{f.close();}
});
test('DELETE agent API detaches SQL bindings and resolves project/workspace selections as absent while retaining all session facts',async()=>{
 const f=fixture();try{
  const a=f.create(),other=f.create(),beforeAgent=f.db.prepare('SELECT * FROM agents WHERE id=?').get(a.id);
  assert.equal((await f.remove(a,null)).status,428);assert.equal((await f.remove(a,'"stale"')).status,409);
  assert.deepEqual(f.db.prepare('SELECT * FROM agents WHERE id=?').get(a.id),beforeAgent);
  const identities=['project','workspace'].map(scope=>({scope,ownerId:'owner',sessionId:'session'}));
  const ref={agentId:a.id,revision:a.revision,contentSha256:a.contentSha256,kind:'project',projectId:null,name:a.name,description:a.description};
  for(const identity of identities)f.store.write(identity,ref,f.store.read(identity).writeETag);
  f.db.prepare("INSERT INTO projects(id,name,kind,root_path,status,created_at,updated_at) VALUES('p','P','code',?,'active','now','now')").run(f.root);
  const nativeRef=JSON.stringify({kind:'pi',sessionId:'native',sessionFile:path.join(f.root,'native.jsonl'),cwd:f.root});
  const history='original Pi history';fs.writeFileSync(path.join(f.root,'native.jsonl'),history);
  f.db.prepare("INSERT INTO sessions(id,project_id,purpose,agent_id,agent_snapshot_json,native_ref_json,created_at,updated_at,ended_at,create_request_key_hash,create_request_sha256) VALUES('s','p','Keep purpose',?,?,?,'created','updated','ended',?,?)").run(a.id,JSON.stringify(ref),nativeRef,'a'.repeat(64),'b'.repeat(64));
  f.db.prepare("INSERT INTO sessions(id,project_id,created_at,updated_at) VALUES('untouched','p','created','updated')").run();
  const before=f.db.prepare("SELECT * FROM sessions WHERE id='s'").get(),untouched=f.db.prepare("SELECT * FROM sessions WHERE id='untouched'").get();
  const result=await f.remove(a);assert.equal(result.status,200);assert.deepEqual(result.body.data,{deleted:true});
  assert.deepEqual(f.db.prepare("SELECT * FROM sessions WHERE id='s'").get(),{...before,agent_id:null,agent_snapshot_json:null});
  assert.deepEqual(f.db.prepare("SELECT * FROM sessions WHERE id='untouched'").get(),untouched);assert(f.agents.get(other.id));
  assert.equal(fs.readFileSync(path.join(f.root,'native.jsonl'),'utf8'),history);assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
  for(const identity of identities){
   const value=f.assistants.read(identity);assert.equal(value.selection,null);assert.equal(f.assistants.resolve(identity),null);
   // Even a cached legacy SQL fallback must not resurrect a deleted assistant.
   assert.equal(f.assistants.read(identity,{...ref,definition:a.definition}).selection,null);
   assert.equal(f.assistants.resolve(identity,{...ref,definition:a.definition}),null);
   const selected=f.assistants.write(identity,{selection:{agentId:other.id,revision:other.revision,contentSha256:other.contentSha256}},value.writeETag);
   assert.equal(selected.selection.agentId,other.id);assert.equal(f.assistants.resolve(identity).agentId,other.id);
  }
 }finally{f.close();}
});
test('DELETE agent API rolls back all detached bindings if deleting the directory fails',async()=>{
 const f=fixture();try{
  const a=f.create();
  f.db.prepare("INSERT INTO projects(id,name,kind,root_path,status,created_at,updated_at) VALUES('p','P','code',?,'active','now','now')").run(f.root);
  for(const id of ['s1','s2'])f.db.prepare("INSERT INTO sessions(id,project_id,agent_id,agent_snapshot_json,created_at,updated_at) VALUES(?,'p',?,?,'now','now')").run(id,a.id,JSON.stringify({agentId:a.id,revision:a.revision,contentSha256:a.contentSha256}));
  const before=f.db.prepare('SELECT * FROM sessions ORDER BY id').all();
  f.db.exec("CREATE TRIGGER controlled_delete_failure BEFORE DELETE ON agents BEGIN SELECT RAISE(ABORT,'controlled failure'); END");
  const result=await f.remove(a);assert.equal(result.status,500);
  assert.deepEqual(f.db.prepare('SELECT * FROM sessions ORDER BY id').all(),before);assert(f.agents.get(a.id));
 }finally{f.close();}
});
test('assistant access API reports damaged versions instead of silently treating them as deleted',()=>{
 const f=fixture();try{
  const a=f.create(),identity={scope:'project',ownerId:'owner',sessionId:'session'};
  f.assistants.write(identity,{selection:{agentId:a.id,revision:a.revision,contentSha256:a.contentSha256}},f.assistants.read(identity).writeETag);
  fs.appendFileSync(path.join(f.root,'agents',a.id,'1','definition.json'),'broken');
  assert.throws(()=>f.assistants.read(identity),e=>e.code==='ROLE_VERSION_MISSING');assert.throws(()=>f.assistants.resolve(identity),e=>e.code==='ROLE_VERSION_MISSING');
 }finally{f.close();}
});
