const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./workspace-fixture.cjs');
const {parseWorkspaceConfiguration}=require('../src/domain/workspace.ts');
test('independent workspaces can repeat directories without sharing records; names are derived',async()=>{const f=fixture();try{
 const body={name:'One',projects:[{rootPath:f.a},{rootPath:f.b}],defaultProjectIndex:1};
 const one=await f.service.save(null,body,'one'),again=await f.service.save(null,body,'one');
 assert.equal(one.id,again.id);assert.equal(one.projects[0].name,'a');assert.equal(one.defaultProjectId,one.projects[1].id);assert.equal('description' in one.projects[0],false);
 const two=await f.service.save(null,{...body,name:'Two'},'two');assert.notEqual(two.projects[0].id,one.projects[0].id);
 f.db.prepare("INSERT INTO projects VALUES('standalone','same',NULL,'code',?,'active','now','now')").run(f.a);
 const updated=await f.service.save(one.id,{...body,name:'Changed',projects:one.projects.map(p=>({id:p.id,rootPath:p.rootPath}))},one.writeETag);
 assert.equal(updated.name,'Changed');assert.equal(f.repository.get(two.id).name,'Two');assert.equal(f.db.prepare("SELECT name FROM projects WHERE id='standalone'").get().name,'same');
 assert.throws(()=>parseWorkspaceConfiguration({...body,defaultProjectIndex:0,projects:[{rootPath:f.a,description:'no'}]}),/未支持/);
 await assert.rejects(f.service.save(null,{...body,name:'Different'},'one'),e=>e.code==='IDEMPOTENCY_CONFLICT');
 }finally{f.close();}});
test('sessions own one workspace memory; creation is atomic, idempotent and default scope immutable',async()=>{const f=fixture();try{
 const w=await f.service.save(null,{name:'Work',projects:[{rootPath:f.a},{rootPath:f.b}],defaultProjectIndex:0},'w');
 const s=f.service.createSession(w.id,{},'s'),retry=f.service.createSession(w.id,{},'s'),second=f.service.createSession(w.id,{},'s2');assert.equal(s.id,retry.id);assert.notEqual(s.id,second.id);
 assert.equal(f.db.prepare('SELECT count(*) n FROM workspace_sessions').get().n,2);assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM session_memories WHERE project_id IS NULL AND workspace_id=?').get(w.id).n,2);
 assert.throws(()=>f.service.createSession(w.id,{defaultProjectId:'wrong'},'bad'),e=>e.code==='START_PROJECT_UNAVAILABLE');assert.equal(f.db.prepare('SELECT count(*) n FROM session_memories').get().n,2);
 assert.throws(()=>f.db.prepare('UPDATE workspace_sessions SET default_project_id=? WHERE id=?').run(w.projects[1].id,s.id),/immutable/);
 await assert.rejects(f.service.save(w.id,{name:'Work',projects:[{id:w.projects[1].id,rootPath:f.b}],defaultProjectIndex:0},w.writeETag),e=>e.code==='START_PROJECT_UNAVAILABLE');
 assert.equal(f.db.pragma('foreign_key_check').length,0);
 }finally{f.close();}});
test('old database reports an explicit schema incompatibility without mutation',()=>{const Database=require('better-sqlite3'),db=new Database(':memory:');try{db.exec('CREATE TABLE projects(id TEXT)');const {createWorkspaceRepository}=require('../src/infrastructure/database/workspace-repository.ts');const repo=createWorkspaceRepository(db);assert.equal(repo.available(),false);assert.throws(()=>repo.list(),e=>e.code==='SCHEMA_INCOMPATIBLE');assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),[{name:'projects'}]);}finally{db.close();}});
