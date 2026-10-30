#!/usr/bin/env node
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const Database=require('better-sqlite3');

const root=path.resolve(__dirname,'..');
const databasePath=path.resolve(process.argv.find((value,index)=>index>1&&!value.startsWith('--'))||process.env.AI_WORKSPACE_DB_PATH||path.join(root,'.data','ai-workspace-v5.sqlite'));
const apply=process.argv.includes('--apply');
const tableExists=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const count=(db,name)=>tableExists(db,name)?Number(db.prepare(`SELECT count(*) AS count FROM "${name.replaceAll('"','""')}"`).get().count):0;
function relatedTables(db){return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND (name='bots' OR name LIKE 'bot\\_%' ESCAPE '\\') ORDER BY name").all().map(row=>row.name);}
function inspect(db){
  const botTables=relatedTables(db),columns=Object.fromEntries(['agents','sessions','projects','session_memories'].map(name=>[name,db.prepare(`PRAGMA table_info("${name}")`).all().map(row=>row.name)]));
  for(const required of ['projects','agents','session_memories','sessions'])if(!tableExists(db,required))throw new Error(`缺少保留表 ${required}；未执行任何改动。`);
  for(const [table,required] of Object.entries({projects:['id','name','root_path','status','created_at','updated_at'],agents:['id','kind','bot_id','project_id','revision','content_sha256','extension_json','policy_json','status'],session_memories:['id','project_id','source_template_id','context_json','draft_json','last_reviewed_entry_id','created_at','updated_at'],sessions:['id','session_memory_id','project_id','purpose','bot_conversation_id','participant_name','assignment','collaboration_state','bot_joined_at','agent_id','agent_snapshot_json','native_ref_json','native_metadata_json','state','created_at','updated_at','last_activity_at','ended_at']})){
    const missing=required.filter(name=>!columns[table].includes(name));if(missing.length)throw new Error(`${table} 缺少预期字段 ${missing.join(', ')}；未执行任何改动。`);
  }
  return {botTables,counts:Object.fromEntries(['projects','agents','sessions','session_memories',...botTables].map(name=>[name,count(db,name)])),sessionBindings:count(db,'sessions')?Number(db.prepare('SELECT count(*) AS count FROM sessions WHERE bot_conversation_id IS NOT NULL').get().count):0,agentOwners:Number(db.prepare('SELECT count(*) AS count FROM agents WHERE bot_id IS NOT NULL OR project_id IS NOT NULL').get().count)};
}
function openHandles(file){
  const candidates=[file,`${file}-wal`,`${file}-shm`],pids=new Set();
  for(const candidate of candidates){const result=spawnSync('lsof',['-t',candidate],{encoding:'utf8'});if(result.error){if(result.error.code==='ENOENT')return {available:false,pids:[]};continue;}for(const pid of result.stdout.split(/\s+/).filter(Boolean))pids.add(pid);}
  return {available:true,pids:[...pids]};
}
function schemaFiles(){return ['bot-schema.sql','agent-binding-schema.sql','role-schema.sql'].map(name=>fs.readFileSync(path.join(root,'src','infrastructure','database',name),'utf8')).join('\n');}
async function applyReset(file,preview){
  const handles=openHandles(file);
  if(!handles.available)throw new Error('无法确认数据库是否离线（lsof 不可用）；为避免服务连接期间改写，已中止。');
  if(handles.pids.length)throw new Error(`数据库仍有打开连接（PID ${handles.pids.join(', ')}）；关闭服务后再执行，脚本不会操作服务启停。`);
  if(preview.agentOwners)throw new Error(`发现 ${preview.agentOwners} 个 Agent 仍带 Bot/Project owner；为保留角色定义与版本，本脚本不会擅自改写 Agent 归属。请先处理这些旧 owner 关系。`);
  const backup=`${file}.pre-bot-reset-${new Date().toISOString().replace(/[:.]/g,'-')}.bak`;
  let db;
  try{
    db=new Database(file);
    db.pragma('busy_timeout=1000');
    await db.backup(backup);
    db.pragma('foreign_keys=OFF');
    const tables=preview.botTables;
    db.transaction(()=>{
      const roleTriggers=['agent_index_insert','agent_identity_update','agent_status_index_update','role_delete_retain','project_agent_binding_insert','project_agent_binding_update','conversation_project_scope_update','conversation_project_agent_insert','conversation_project_agent_update','session_bot_agent_binding','session_parent_fixed','session_agent_fixed','session_role_insert','session_role_update','session_snapshot_started','session_assignment_busy','bots_role_insert','bots_role_update','conversation_agent_fixed','conversation_role_insert','conversation_role_update'];
      const triggers=db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND (name LIKE 'bot\\_%' ESCAPE '\\' OR lower(sql) LIKE '%bot_%' OR lower(sql) LIKE '%bots%')").all();
      for(const name of roleTriggers)triggers.push({name});
      for(const {name} of triggers)db.exec(`DROP TRIGGER IF EXISTS "${name.replaceAll('"','""')}"`);
      for(const name of ['sessions_bot_owner_idx','agents_kind_status_idx'])db.exec(`DROP INDEX IF EXISTS "${name}"`);
      db.prepare("UPDATE sessions SET bot_conversation_id=NULL,participant_name=NULL,assignment=NULL,collaboration_state=NULL,bot_joined_at=NULL WHERE bot_conversation_id IS NOT NULL").run();
      for(const name of [...tables].sort((a,b)=>a==='bots'?1:b==='bots'?-1:a.localeCompare(b)))db.exec(`DROP TABLE IF EXISTS "${name.replaceAll('"','""')}"`);
      db.exec(schemaFiles());
    })();
    db.pragma('foreign_keys=ON');
    const integrity=db.pragma('integrity_check');
    if(integrity.length!==1||integrity[0].integrity_check!=='ok')throw new Error('SQLite integrity_check 失败；备份已保留。');
    const foreignKeys=db.pragma('foreign_key_check');
    if(foreignKeys.length)throw new Error(`foreign_key_check 发现 ${foreignKeys.length} 条问题；备份已保留。`);
    const after=inspect(db);
    for(const name of ['projects','agents','sessions','session_memories'])if(after.counts[name]!==preview.counts[name])throw new Error(`保留表 ${name} 的记录数发生变化；备份已保留。`);
    if(after.sessionBindings!==0)throw new Error(`仍有 ${after.sessionBindings} 条 Bot Session 绑定；备份已保留。`);
    return {applied:true,backup,removedTables:tables,removedRows:Object.fromEntries(tables.map(name=>[name,preview.counts[name]])),preservedCounts:Object.fromEntries(['projects','agents','sessions','session_memories'].map(name=>[name,after.counts[name]])),detachedSessions:preview.sessionBindings,integrity:'ok',foreignKeyViolations:0};
  } finally {db?.close();}
}
async function main(){
  if(!fs.existsSync(databasePath))throw new Error(`数据库文件不存在：${databasePath}`);
  const db=new Database(databasePath,{readonly:!apply,fileMustExist:true});
  try{
    const preview=inspect(db);
    const report={databasePath,mode:apply?'apply':'preview',warning:'Bot 配置、总对话、Work、Task、Execution、Message 与 Bot 项目范围关系将永久删除；Project、Agent、Session、SessionMemory 和项目 Pi 历史保留。',...preview};
    db.close();
    if(!apply){console.log(JSON.stringify(report,null,2));return;}
    console.log(JSON.stringify(await applyReset(databasePath,preview),null,2));
  }finally{try{db.close();}catch{}}
}
if(require.main===module){main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});}
module.exports={inspect,applyReset,relatedTables};
