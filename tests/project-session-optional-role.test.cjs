require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),Database=require('better-sqlite3');
const {targetSchema}=require('../src/infrastructure/database/schema.server.ts');
const {createProjectSessionService}=require('../src/application/project-session-service.ts');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('target schema permits a role-less session but rejects invalid selected roles',()=>{
 const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec(targetSchema);
 db.prepare("INSERT INTO projects VALUES('p','P',NULL,'code','/tmp','active','now','now')").run();
 const insert=db.prepare("INSERT INTO sessions(id,project_id,purpose,agent_id,agent_snapshot_json,created_at,updated_at) VALUES(?,'p','test',?,?,'now','now')");
 insert.run('s1',null,null);
 assert.throws(()=>insert.run('s2','missing',JSON.stringify({agentId:'missing',revision:1,contentSha256:'a'.repeat(64)})),/invalid project role/);
 assert.equal(db.prepare('SELECT agent_id FROM sessions WHERE id=?').get('s1').agent_id,null);db.close();
});

test('project creation without an agent does not invoke role lookup',()=>{
 const {createProjectOperationStore}=require('../src/infrastructure/projects/operation-journal.server.ts');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'optional-role-create-'));let received,session;
 const service=createProjectSessionService({projects:{get:()=>({id:'p',status:'active'})},sessions:{get:()=>session??null,create:input=>(received=input,session={...input,id:input.stableId,state:'not_started',nativeRef:null,endedAt:null})},operations:createProjectOperationStore(root),role:()=>{throw Error('unexpected role lookup');}});
 try{assert.equal(service.create('p',{},'create').id,session.id);assert.equal(received.agentId,null);assert.equal(received.agentSnapshot,null);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
