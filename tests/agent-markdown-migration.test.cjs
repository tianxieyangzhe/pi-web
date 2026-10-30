require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),Database=require('better-sqlite3'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {coreSchema}=require('../src/infrastructure/database/schema.server.ts');
const {migrateAgentMarkdown}=require('../scripts/migrate-agent-markdown-v3.cjs');

test('Agent Markdown v3 adds the file index, preserves legacy rows, and snapshots historical Project scope',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-md-v3-')),file=path.join(dir,'workspace.sqlite'),db=new Database(file);
  db.pragma('foreign_keys=ON');
  const oldCore=coreSchema.replace(/\s+content_sha256 TEXT CHECK\(content_sha256 IS NULL OR length\(content_sha256\)=64\),\n/,"\n");
  assert.notEqual(oldCore,coreSchema);
  db.exec(oldCore+fs.readFileSync(path.join(__dirname,'../scripts/bot-schema-v1.sql'),'utf8'));
  db.prepare("INSERT INTO projects(id,name,description,kind,root_path,status,created_at,updated_at) VALUES('p','Project',NULL,'code','/tmp/project','active','t','t')").run();
  db.prepare("INSERT INTO bots(id,name,working_directory,workspace_kind,instructions,max_parallel_executions,status,created_at,updated_at) VALUES('b','Bot','/tmp/bot','managed','legacy',4,'active','t','t')").run();
  db.prepare("INSERT INTO agents(id,name,description,kind,bot_id,project_id,source_template_id,definition_json,extension_json,policy_json,revision,status,created_at,updated_at) VALUES('coord','Coordinator',NULL,'coordinator','b',NULL,NULL,'{\"instructions\":\"legacy coordinator\"}','{}','{}',1,'active','t','t')").run();
  db.prepare("INSERT INTO agents(id,name,description,kind,bot_id,project_id,source_template_id,definition_json,extension_json,policy_json,revision,status,created_at,updated_at) VALUES('worker','Project worker',NULL,'project',NULL,'p',NULL,'{\"instructions\":\"legacy project role\"}','{}','{}',1,'active','t','t')").run();
  const coordinator=JSON.stringify({agentId:'coord',revision:1,kind:'coordinator',botId:'b',projectId:null,name:'Coordinator',description:null,definition:{instructions:'legacy coordinator',capabilities:{readFiles:true,writeFiles:false,readProjects:false,dispatchTasks:false,dispatchProjectWrites:false,exchangeMessages:false}}});
  db.prepare("INSERT INTO bot_conversations(id,bot_id,title,goal,instructions_snapshot,work_state,runtime_state,created_at,updated_at) VALUES('c','b','Conversation','','legacy coordinator snapshot','paused','idle','t','t')").run();
  const context=JSON.stringify({summary:'historical'});
  db.prepare("INSERT INTO session_memories(id,project_id,title,context_json,created_at,updated_at) VALUES('m','p','Memory',?,'t','t')").run(context);
  const oldProjectAgent=JSON.stringify({agentId:'worker',revision:1,kind:'project',botId:null,projectId:'p',name:'Project worker',description:null,definition:{instructions:'legacy project role',capabilities:{readFiles:true,writeFiles:false,readProjects:false,dispatchTasks:false,dispatchProjectWrites:false,exchangeMessages:false}}});
  db.prepare("INSERT INTO sessions(id,session_memory_id,project_id,purpose,bot_conversation_id,collaboration_state,bot_joined_at,agent_id,agent_snapshot_json,state,updated_at,created_at) VALUES('s','m','p','Project session','c','active','t','worker',?,'idle','t','t')").run(oldProjectAgent);
  const tables=['projects','agents','bots','bot_conversations','sessions','session_memories'],historical=Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table}${table==='agents'?' ORDER BY id':''}`).all()]));db.close();

  const preview=await migrateAgentMarkdown(file);assert.equal(preview.historicalConversationProjectScopesToPreserve.length,1);assert.deepEqual(preview.botDefaultProjectSets,'留空；不会用历史 Project 并集推断未来范围');
  const beforeApply=new Database(file,{readonly:true});assert.equal(beforeApply.prepare("SELECT name FROM sqlite_master WHERE name='bot_project_agents'").get(),undefined);beforeApply.close();
  const applied=await migrateAgentMarkdown(file,{apply:true,checkOffline:false});assert.equal(applied.applied,true);assert.equal(applied.agentMarkdownFilesCreated,0);assert.equal(applied.legacyAgentsActivated,0);
  const result=new Database(file,{readonly:true});
  for(const [table,rows] of Object.entries(historical)){const priorColumns=Object.keys(rows[0]??{}),actual=result.prepare(`SELECT * FROM ${table}${table==='agents'?' ORDER BY id':''}`).all().map(row=>Object.fromEntries(priorColumns.map(key=>[key,row[key]])));assert.deepEqual(actual,rows,`${table} 历史值保持`);}
  assert(result.prepare('PRAGMA table_info(agents)').all().some(column=>column.name==='content_sha256'));
  assert.equal(result.prepare("SELECT content_sha256 FROM agents WHERE id='coord'").get().content_sha256,null);
  assert.deepEqual(result.prepare('SELECT bot_id,project_id FROM bot_projects').all(),[]);
  assert.deepEqual(result.prepare('SELECT bot_id,project_id,agent_id FROM bot_project_agents').all(),[]);
  assert.deepEqual(result.prepare('SELECT bot_conversation_id,project_id FROM bot_conversation_projects').all(),[{bot_conversation_id:'c',project_id:'p'}]);
  assert.deepEqual(result.prepare('SELECT * FROM bot_conversation_project_agents').all(),[]);
  assert.deepEqual(result.pragma('foreign_key_check'),[]);assert.equal(result.pragma('integrity_check',{simple:true}),'ok');result.close();fs.rmSync(dir,{recursive:true,force:true});
});
