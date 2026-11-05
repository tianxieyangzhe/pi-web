require('./register.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const Database=require('better-sqlite3');
const {coreSchema,botSchema,agentBindingSchema,roleSchema}=require('../src/infrastructure/database/schema.server.ts');
const {createBotRepository}=require('../src/infrastructure/database/bot-repository.ts');

function makeDatabase(file,{legacySession=false}={}){
  const legacyCore=legacySession?coreSchema.replace("    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),\n",'').replace("    CHECK((status='closed' AND ended_at IS NOT NULL) OR status='open'),\n",''):coreSchema,
    sql=legacyCore+botSchema+agentBindingSchema+roleSchema;
  const db=new Database(file);db.exec(sql);
  const now='2026-10-15T00:00:00.000Z',hash='a'.repeat(64);
  db.prepare("INSERT INTO projects VALUES('p','保留项目',NULL,'code','/tmp/reset-p','active',?,?)").run(now,now);
  const addAgent=db.prepare("INSERT INTO agents(id,name,description,kind,bot_id,project_id,source_template_id,definition_json,extension_json,policy_json,revision,content_sha256,status,created_at,updated_at) VALUES(?,?,NULL,?,NULL,NULL,NULL,'{}','{}','{}',1,?,'active',?,?)");
  addAgent.run('coordinator','协调者','coordinator',hash,now,now);addAgent.run('project-agent','项目角色','project','b'.repeat(64),now,now);
  const coordinator={agentId:'coordinator',kind:'coordinator',revision:1,botId:null,projectId:null,contentSha256:hash,name:'协调者',description:null},projectRole={agentId:'project-agent',kind:'project',revision:1,botId:null,projectId:null,contentSha256:'b'.repeat(64),name:'项目角色',description:null,definition:{instructions:'项目角色指导',capabilities:{readFiles:true,writeFiles:true,readProjects:false,dispatchTasks:false,dispatchProjectWrites:false,exchangeMessages:true}}};
  db.prepare("INSERT INTO bots VALUES('b','Bot',NULL,'/tmp/reset-bot','managed','coordinator',?,4,'active',?,?)").run(JSON.stringify(coordinator),now,now);
  db.prepare("INSERT INTO bot_conversations VALUES('c','b','对话','','coordinator',?,'open','enabled',NULL,?,?,NULL)").run(JSON.stringify(coordinator),now,now);
  db.prepare("INSERT INTO bot_projects VALUES('b','p',?)").run(now);
  db.prepare("INSERT INTO bot_project_agents VALUES('b','p','project-agent',1,?,?)").run('b'.repeat(64),now);
  db.prepare("INSERT INTO bot_conversation_projects VALUES('c','p',?)").run(now);
  db.prepare("INSERT INTO bot_conversation_project_agents VALUES('c','p','project-agent',1,?,?)").run('b'.repeat(64),now);
  const memory={summary:'项目记忆',goal:'保留',constraints:[],facts:[],decisions:[],nextActions:[],outputs:[]};
  db.prepare("INSERT INTO session_memories(id,project_id,source_template_id,title,context_json,draft_json,last_reviewed_entry_id,created_at,updated_at) VALUES('m','p',NULL,'记忆',?,NULL,NULL,?,?)").run(JSON.stringify(memory),now,now);
  const sessionColumns=legacySession?'id,session_memory_id,project_id,purpose,bot_conversation_id,participant_name,assignment,collaboration_state,bot_joined_at,updated_at,agent_id,agent_snapshot_json,mcp_ids_json,mcp_snapshots_json,state,native_ref_json,native_metadata_json,created_at,last_activity_at,ended_at':'id,session_memory_id,project_id,purpose,bot_conversation_id,participant_name,assignment,collaboration_state,bot_joined_at,updated_at,status,agent_id,agent_snapshot_json,mcp_ids_json,mcp_snapshots_json,state,native_ref_json,native_metadata_json,created_at,last_activity_at,ended_at',
    sessionValues=legacySession?"VALUES('s','m','p','主题','c','项目 Session','职责','active',?,?,'project-agent',?,'[]','[]','idle',?,'{}',?,NULL,NULL)":"VALUES('s','m','p','主题','c','项目 Session','职责','active',?,?,'open','project-agent',?,'[]','[]','idle',?,'{}',?,NULL,NULL)";
  db.prepare(`INSERT INTO sessions(${sessionColumns}) ${sessionValues}`).run(now,now,JSON.stringify(projectRole),JSON.stringify({kind:'pi',sessionFile:'/tmp/project-session.jsonl',sessionId:'native-session',cwd:'/tmp/reset-p'}),now);
  return db;
}

test('Bot reset defaults to preview, detaches Bot Session binding and preserves project, roles, memory and Pi reference',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bot-reset-')),file=path.join(dir,'workspace.sqlite'),db=makeDatabase(file,{legacySession:true});
  const sessionColumns=['id','session_memory_id','project_id','purpose','status','agent_id','agent_snapshot_json','mcp_ids_json','mcp_snapshots_json','state','native_ref_json','native_metadata_json','created_at','last_activity_at','ended_at'].filter(name=>(db.prepare('PRAGMA table_info(sessions)').all()).some(column=>column.name===name)),sessionSelect=sessionColumns.join(','),
    projectBefore=db.prepare('SELECT * FROM projects').all(),agentBefore=db.prepare('SELECT * FROM agents').all(),memoryBefore=db.prepare('SELECT * FROM session_memories').all(),sessionBefore=db.prepare(`SELECT ${sessionSelect} FROM sessions`).all();
  db.close();
  const preview=require('node:child_process').spawnSync(process.execPath,['scripts/reset-bot-data.cjs',file],{encoding:'utf8'});assert.equal(preview.status,0,preview.stderr);assert.match(preview.stdout,/"mode": "preview"/);
  const checkPreview=new Database(file,{readonly:true});assert.equal(checkPreview.prepare("SELECT count(*) AS count FROM bots").get().count,1);checkPreview.close();

  const filename=path.resolve('scripts/reset-bot-data.cjs'),realRequire=createRequire(filename),moduleValue={exports:{}};
  const context={module:moduleValue,require:name=>name==='node:child_process'?{...realRequire(name),spawnSync:()=>({status:1,stdout:''})}:realRequire(name),__dirname:path.dirname(filename),process,console};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),context,{filename});
  const applyDb=new Database(file),previewData=moduleValue.exports.inspect(applyDb);applyDb.close();
  const result=await moduleValue.exports.applyReset(file,previewData);
  assert.equal(result.applied,true);assert.equal(result.detachedSessions,1);
  const after=new Database(file);assert.equal(after.prepare("SELECT count(*) AS count FROM bots").get().count,0);assert.equal(after.prepare("SELECT count(*) AS count FROM bot_works").get().count,0);
  assert.deepEqual(after.prepare('SELECT * FROM projects').all(),projectBefore);assert.deepEqual(after.prepare('SELECT * FROM agents').all(),agentBefore);assert.deepEqual(after.prepare('SELECT * FROM session_memories').all(),memoryBefore);assert.deepEqual(after.prepare(`SELECT ${sessionSelect} FROM sessions`).all(),sessionBefore);
  const detached=after.prepare('SELECT bot_conversation_id,participant_name,assignment,collaboration_state,bot_joined_at FROM sessions WHERE id=\'s\'').get();assert.deepEqual(detached,{bot_conversation_id:null,participant_name:null,assignment:null,collaboration_state:null,bot_joined_at:null});assert.equal(after.prepare('PRAGMA table_info(sessions)').all().some(column=>column.name==='status'),false);assert.equal(createBotRepository(after).available(),true);assert.deepEqual(after.pragma('foreign_key_check'),[]);assert.ok(fs.existsSync(result.backup));after.close();
  process.env.AI_WORKSPACE_DB_PATH=file;const {sessionRepository}=require('../src/infrastructure/database/session-repository.server.ts'),{database}=require('../src/infrastructure/database/database.server.ts');
  assert.equal(sessionRepository.get('s').status,'open');assert.equal(sessionRepository.updateRuntime('s',{state:'ended',endedAt:new Date().toISOString()}).status,'closed');database.close();delete process.env.AI_WORKSPACE_DB_PATH;
});
