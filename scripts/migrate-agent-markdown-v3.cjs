#!/usr/bin/env node
// Offline-only migration. Preview is the default; --apply is explicit.
const fs=require('node:fs');
const path=require('node:path');
const Database=require('better-sqlite3');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),schemaDir=path.join(root,'src/infrastructure/database');
const bindingSchema=fs.readFileSync(path.join(schemaDir,'agent-binding-schema.sql'),'utf8');
const roleSchema=fs.readFileSync(path.join(schemaDir,'role-schema.sql'),'utf8');
const relationTables=['bot_projects','bot_project_agents','bot_conversation_projects','bot_conversation_project_agents'];
const replacedTriggers=['agent_owner_insert','agent_owner_update','agent_template_insert','agent_template_update','agent_definition_insert','agent_definition_update','agent_index_insert','agent_identity_update','agent_status_index_update','project_agent_binding_insert','project_agent_binding_update','conversation_project_scope_update','conversation_project_agent_insert','conversation_project_agent_update','session_parent_fixed','session_agent_fixed','session_role_insert','session_role_update','session_bot_agent_binding','session_snapshot_started','session_assignment_busy','bots_role_insert','bots_role_update','conversation_agent_fixed','conversation_role_insert','conversation_role_update','task_waiting_update','role_retain','role_delete_retain','sessions_snapshot_identity_insert','sessions_snapshot_identity_update','bots_snapshot_identity_insert','bots_snapshot_identity_update','bot_conversations_snapshot_identity_insert','bot_conversations_snapshot_identity_update'];
const replacedIndexes=['agents_owner_idx','agents_kind_status_idx','sessions_bot_owner_idx','bot_projects_project_idx','bot_project_agents_agent_idx','bot_conversation_projects_project_idx','bot_conversation_project_agents_agent_idx'];
const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
const stable=rows=>rows.map(row=>JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key]])))).sort();
function tableNames(db){return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(x=>x.name));}
function inspect(db){
  const tables=tableNames(db),required=['agents','sessions','bots','bot_conversations','bot_tasks','bot_task_dependencies','bot_executions','bot_messages'];
  if(required.some(name=>!tables.has(name)))throw Error('数据库不是已迁移的六表 Bot 结构，未更改任何内容');
  const agentColumns=new Set(db.prepare('PRAGMA table_info(agents)').all().map(x=>x.name));
  if(!agentColumns.has('definition_json')||!agentColumns.has('revision'))throw Error('agents 历史结构不符合迁移来源，未更改任何内容');
  const existingRelations=relationTables.filter(name=>tables.has(name));
  if(existingRelations.length&&existingRelations.length!==relationTables.length)throw Error('发现部分 Agent 绑定表，状态不完整；未更改任何内容');
  const scopeRows=db.prepare(`SELECT bot_conversation_id,project_id,MIN(COALESCE(bot_joined_at,created_at)) AS added_at FROM sessions WHERE bot_conversation_id IS NOT NULL GROUP BY bot_conversation_id,project_id ORDER BY bot_conversation_id,project_id`).all();
  const projectsByBot=db.prepare(`SELECT c.bot_id,s.project_id FROM sessions s JOIN bot_conversations c ON c.id=s.bot_conversation_id WHERE s.bot_conversation_id IS NOT NULL GROUP BY c.bot_id,s.project_id ORDER BY c.bot_id,s.project_id`).all();
  return {tables,agentColumns,alreadyMigrated:agentColumns.has('content_sha256')&&existingRelations.length===relationTables.length,scopeRows,projectsByBot,
    counts:Object.fromEntries([...tables].map(name=>[name,db.prepare(`SELECT count(*) AS n FROM ${quote(name)}`).get().n]))};
}
function preserveExistingRows(db,before){
  for(const [table,oldRows] of Object.entries(before)){
    const priorColumns=oldRows.length?Object.keys(oldRows[0]):[],actual=priorColumns.length?db.prepare(`SELECT * FROM ${quote(table)}`).all().map(row=>Object.fromEntries(priorColumns.map(key=>[key,row[key]]))):[];
    if(JSON.stringify(stable(actual))!==JSON.stringify(stable(oldRows)))throw Error(`迁移改变了历史数据：${table}`);
  }
}
function offlineCheck(databasePath){
  const occupancy=spawnSync('lsof',['-t','--',databasePath],{encoding:'utf8',timeout:10000}),listener=spawnSync('lsof',['-t','-iTCP:3000','-sTCP:LISTEN'],{encoding:'utf8',timeout:10000});
  const occupancyPids=occupancy.stdout.trim().split(/\s+/).filter(Boolean).map(Number).filter(pid=>pid!==process.pid);
  if(occupancy.error||(occupancy.status!==0&&occupancy.status!==1)||occupancy.stderr.trim()||occupancyPids.length)throw Error('数据库仍有打开连接或无法核对；未迁移');
  if(listener.error||(listener.status!==0&&listener.status!==1)||listener.stderr.trim()||listener.stdout.trim())throw Error('3000 服务仍在运行或无法核对；未迁移');
}

async function migrateAgentMarkdown(databasePath,options={}){
  databasePath=path.resolve(databasePath);
  const apply=options.apply===true,db=new Database(databasePath,{readonly:!apply,fileMustExist:true,timeout:5000});
  try{
    db.pragma('busy_timeout=5000');
    const state=inspect(db);
    if(state.alreadyMigrated)return {database:databasePath,alreadyMigrated:true,message:'Agent Markdown 目录索引与 Bot 绑定表已存在，无需迁移'};
    const plan={database:databasePath,mode:apply?'apply':'preview',existingRows:state.counts,legacyAgentRows:state.counts.agents??0,preserveLegacyAgentRows:true,activateLegacyAgents:false,contentSha256RowsToAdd:state.agentColumns.has('content_sha256')?0:(state.counts.agents??0),relationTablesToCreate:relationTables,historicalConversationProjectScopesToPreserve:state.scopeRows,projectsByBotForManualConfiguration:state.projectsByBot,botDefaultProjectSets:'留空；不会用历史 Project 并集推断未来范围',historicalProjectAgentBindings:'留空；旧 owner/角色名不会自动变成新运行绑定',newCoordinatorBindings:'不自动创建或转换',executesModelOrPi:false,warning:'执行前必须停止应用服务并确认数据库离线；本脚本默认只预览。旧 definition_json、扩展/权限、快照与 Pi 历史保持原样。'};
    if(!apply)return plan;
    if(options.checkOffline!==false)offlineCheck(databasePath);
    db.pragma('foreign_keys=ON');
    const backupPath=`${databasePath}.before-agent-markdown-v3.bak`;
    if(fs.existsSync(backupPath))throw Error(`备份已存在，拒绝覆盖：${backupPath}`);
    await db.backup(backupPath);
    const before=Object.fromEntries([...state.tables].map(name=>[name,db.prepare(`SELECT * FROM ${quote(name)}`).all()]));
    db.exec('BEGIN EXCLUSIVE');
    try{
      if(!state.agentColumns.has('content_sha256'))db.exec('ALTER TABLE agents ADD COLUMN content_sha256 TEXT CHECK(content_sha256 IS NULL OR length(content_sha256)=64)');
      for(const name of replacedTriggers)db.exec(`DROP TRIGGER IF EXISTS ${quote(name)}`);
      for(const name of replacedIndexes)db.exec(`DROP INDEX IF EXISTS ${quote(name)}`);
      db.exec(bindingSchema);
      const addScope=db.prepare('INSERT INTO bot_conversation_projects(bot_conversation_id,project_id,added_at) VALUES(?,?,?)');
      for(const row of state.scopeRows)addScope.run(row.bot_conversation_id,row.project_id,row.added_at);
      db.exec(roleSchema);
      preserveExistingRows(db,before);
      if(db.pragma('foreign_key_check').length)throw Error('外键检查失败');
      if(db.pragma('integrity_check',{simple:true})!=='ok')throw Error('SQLite 完整性检查失败');
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return {database:databasePath,applied:true,backup:backupPath,integrity:'ok',foreignKeys:'ok',historicalConversationProjectScopes:state.scopeRows.length,legacyAgentRowsPreserved:state.counts.agents??0,agentMarkdownFilesCreated:0,legacyAgentsActivated:0};
  }finally{db.close();}
}

if(require.main===module){
  const argv=process.argv.slice(2),apply=argv.includes('--apply'),file=argv.find(x=>x!=='--apply');
  if(!file){console.error('Usage: node scripts/migrate-agent-markdown-v3.cjs <database-path> [--apply]');process.exit(2);}
  migrateAgentMarkdown(file,{apply}).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={migrateAgentMarkdown,inspect};
