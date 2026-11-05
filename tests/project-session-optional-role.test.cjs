require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),Database=require('better-sqlite3');
const {targetSchema}=require('../src/infrastructure/database/schema.server.ts');
const {createProjectSessionService}=require('../src/application/project-session-service.ts');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
const originalLoad=Module._load;
Module._load=function(name,...args){
 if(name==='@earendil-works/pi-coding-agent') return {
  createReadToolDefinition:()=>({name:'read',label:'read',description:''}),
  createLsToolDefinition:()=>({name:'ls',label:'ls',description:''}),
  createEditToolDefinition:()=>({name:'edit',label:'edit',description:''}),
  createWriteToolDefinition:(root,{operations})=>({name:'write',label:'write',description:'',execute:async(_id,args)=>operations.writeFile(path.resolve(root,args.path),args.content)}),
 };
 return originalLoad.call(this,name,...args);
};
const {createPiProjectTools}=require('../src/infrastructure/projects/pi-project-tools.server.ts');
Module._load=originalLoad;

test('target schema permits a role-less session but rejects invalid selected roles',()=>{
 const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec(targetSchema);
 db.prepare("INSERT INTO projects VALUES('p','P',NULL,'code','/tmp','active','now','now')").run();
 const context=JSON.stringify({summary:'',goal:'',constraints:[],facts:[],decisions:[],nextActions:[],outputs:[]});
 for(const id of ['m1','m2']) db.prepare("INSERT INTO session_memories(id,project_id,source_template_id,title,context_json,draft_json,last_reviewed_entry_id,created_at,updated_at) VALUES(?,'p',NULL,'memory',?,NULL,NULL,'now','now')").run(id,context);
 const insert=db.prepare("INSERT INTO sessions(id,session_memory_id,project_id,purpose,agent_id,agent_snapshot_json,state,created_at,updated_at) VALUES(?,?, 'p','test',?,?,'idle','now','now')");
 insert.run('s1','m1',null,null);
 assert.throws(()=>insert.run('s2','m2','missing',JSON.stringify({agentId:'missing',revision:1,contentSha256:'a'.repeat(64)})),/invalid project role/);
 assert.equal(db.prepare('SELECT agent_id FROM sessions WHERE id=?').get('s1').agent_id,null);db.close();
});

test('project creation without an agent does not invoke role lookup',()=>{
 let received;
 const session={id:'s',projectId:'p',sessionMemoryId:'m',agentId:null,agentSnapshot:null,mcpSnapshots:[],state:'idle',nativeRef:null};
 const service=createProjectSessionService({projects:{get:()=>({id:'p',status:'active'})},sessions:{},memories:{createSession:(...args)=>(received=args,session),get:()=>null},role:()=>{throw Error('unexpected role lookup');}});
 assert.equal(service.create('p',{}).id,'s');assert.equal(received[4],undefined);
});

test('independent tools allow project writes but protect sensitive and outside paths; bot policy unchanged',async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'optional-role-tools-')));
 try {
  const base={workingDirectory:root,session:{agentSnapshot:null},allowProjectRead:true,allowProjectWrite:true};
  const tools=await createPiProjectTools({...base,independentProjectTools:true});
  assert.deepEqual(tools.map(t=>t.name),['project_read','project_list','project_edit','project_write']);
  const write=tools.find(t=>t.name==='project_write');
  await write.execute('call',{path:'ok.txt',content:'ok'},undefined,()=>{});
  assert.equal(fs.readFileSync(path.join(root,'ok.txt'),'utf8'),'ok');
  await assert.rejects(()=>write.execute('call',{path:'.env',content:'bad'},undefined,()=>{}));
  await assert.rejects(()=>write.execute('call',{path:'../outside.txt',content:'bad'},undefined,()=>{}));
  let allowed=false;
  const guarded=(await createPiProjectTools({...base,independentProjectTools:true},()=>allowed)).find(t=>t.name==='project_write');
  await assert.rejects(()=>guarded.execute('read',{path:'blocked.txt',content:'bad'},undefined,()=>{}),/不允许写入/);
  assert.equal(fs.existsSync(path.join(root,'blocked.txt')),false);
  allowed=true; await guarded.execute('write',{path:'allowed.txt',content:'ok'},undefined,()=>{});
  allowed=false; await assert.rejects(()=>guarded.execute('after',{path:'allowed.txt',content:'bad'},undefined,()=>{}),/不允许写入/);
  assert.equal(fs.readFileSync(path.join(root,'allowed.txt'),'utf8'),'ok');
  assert.deepEqual(await createPiProjectTools(base),[]);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
