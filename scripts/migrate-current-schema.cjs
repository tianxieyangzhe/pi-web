#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process'),Database=require('better-sqlite3');
const ROOT=path.resolve(__dirname,'..');
const SUPPORTED_SOURCE='d474c2b94f1e7209229116abd6e09a4da60d1105169c7eab2202fb0e0f13ae2f';
const TABLES=['projects','mcps','agents','sessions','workspaces','workspace_projects','workspace_sessions'];
const RETIRED=['bots','bot_conversations','project_calls','bot_projects','bot_project_agents','bot_conversation_projects','bot_conversation_project_agents'];
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
const digest=value=>hash(canonical(value));
const quote=name=>'"'+name.replaceAll('"','""')+'"';
function schema(db){return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();}
function schemaHash(db){return hash(JSON.stringify(schema(db)));}
function rows(db,name){return db.prepare('SELECT * FROM '+quote(name)).all().sort((a,b)=>canonical(a).localeCompare(canonical(b),'en'));}
function data(db){return Object.fromEntries(schema(db).filter(o=>o.type==='table').map(o=>[o.name,rows(db,o.name)]));}
function targetSchema(){return ['core-schema.sql','role-schema.sql','workspace-schema.sql'].map(n=>fs.readFileSync(path.join(ROOT,'src/infrastructure/database',n),'utf8')).join('\n');}
function regular(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||fs.realpathSync(file)!==path.resolve(file))throw Error('Not a regular non-symlink file: '+file);return fs.readFileSync(file);}
function syncDir(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function writeExclusive(file,bytes,mode=0o400){const fd=fs.openSync(file,'wx',mode);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDir(path.dirname(file));}
function checkConnections(file){const result=spawnSync('lsof',['-t','--',file,file+'-wal',file+'-shm'],{encoding:'utf8'});if(result.error||![0,1].includes(result.status))throw Error('Cannot verify open database connections');if(result.stdout.trim())throw Error('Database has open connections: '+[...new Set(result.stdout.trim().split(/\s+/))].join(','));}
function checkNative(target){const ids=new Set(),files=new Set();for(const table of ['sessions','workspace_sessions'])for(const row of target[table]){if(!row.native_ref_json)continue;const ref=JSON.parse(row.native_ref_json);if(ref.kind!=='pi'||!ref.sessionId||!ref.sessionFile||!ref.cwd)throw Error('Invalid native identity: '+row.id);if(ids.has(ref.sessionId)||files.has(ref.sessionFile))throw Error('Duplicate native identity: '+row.id);ids.add(ref.sessionId);files.add(ref.sessionFile);const parent=table==='sessions'?target.projects.find(p=>p.id===row.project_id):target.workspace_projects.find(p=>p.id===row.default_project_id&&p.workspace_id===row.workspace_id);if(!parent||parent.root_path!==ref.cwd)throw Error('Native cwd mismatch: '+row.id);}}
function fill(db,target,sql){
 db.exec(sql);const triggers=schema(db).filter(o=>o.type==='trigger');for(const t of triggers)db.exec('DROP TRIGGER '+quote(t.name));
 for(const table of TABLES){const columns=db.prepare('PRAGMA table_info('+quote(table)+')').all().map(c=>c.name);const insert=db.prepare('INSERT INTO '+quote(table)+'('+columns.map(quote).join(',')+') VALUES('+columns.map(()=>'?').join(',')+')');for(const row of target[table])insert.run(...columns.map(c=>row[c]));}
 for(const t of triggers)db.exec(t.sql);
 if(db.pragma('foreign_key_check').length||db.pragma('integrity_check',{simple:true})!=='ok')throw Error('Target integrity or foreign-key check failed');
 if(digest(data(db))!==digest(target))throw Error('Target row verification failed');
}
function buildPlan(file,{agentRoot=path.join(path.dirname(file),'agents'),supportedSource=SUPPORTED_SOURCE}={}){
 file=path.resolve(file);regular(file);const db=new Database(file,{readonly:true,fileMustExist:true});
 try{
  const sql=targetSchema(),expected=new Database(':memory:');expected.exec(sql);const targetHash=schemaHash(expected);
  if(schemaHash(db)===targetHash){expected.close();return {status:'current',database:file,targetSchemaSha256:targetHash};}
  if(schemaHash(db)!==supportedSource)throw Error('Unsupported source schema; no data changed');
  const source=data(db),names=Object.keys(source).sort();if(canonical(names)!==canonical([...TABLES,...RETIRED].sort()))throw Error('Unknown or missing source tables');
  if(db.pragma('integrity_check',{simple:true})!=='ok'||db.pragma('foreign_key_check').length)throw Error('Source integrity check failed');
  const target={},versions=[],mapped=new Map();
  for(const table of TABLES){const cols=expected.prepare('PRAGMA table_info('+quote(table)+')').all().map(c=>c.name);target[table]=source[table].map(row=>{for(const c of cols)if(!Object.hasOwn(row,c))throw Error('Missing source column '+table+'.'+c);return Object.fromEntries(cols.map(c=>[c,row[c]]));});}expected.close();
  const retiredAgents=target.agents.filter(a=>a.kind==='coordinator').map(a=>a.id);target.agents=target.agents.filter(a=>!retiredAgents.includes(a.id));
  const used=new Map();for(const agent of target.agents){if(agent.kind!=='project'||!agent.content_sha256)throw Error('Unconvertible Agent: '+agent.id);used.set(agent.id,new Map([[agent.revision,agent.content_sha256]]));}
  for(const s of target.sessions){if(!s.agent_id)continue;const refs=used.get(s.agent_id),ref=JSON.parse(s.agent_snapshot_json);if(!refs||!ref||ref.agentId!==s.agent_id||ref.kind!=='project'||!Number.isInteger(ref.revision)||!ref.contentSha256)throw Error('Unconvertible session Agent binding: '+s.id);if(refs.has(ref.revision)&&refs.get(ref.revision)!==ref.contentSha256)throw Error('Conflicting Agent digest');refs.set(ref.revision,ref.contentSha256);}
  for(const agent of target.agents){let revision=agent.revision;for(const [oldRevision,oldHash] of [...used.get(agent.id)].sort((a,b)=>a[0]-b[0])){
   if(!/^[A-Za-z0-9_-]{1,160}$/.test(agent.id))throw Error('Unsafe Agent ID');const oldPath=path.resolve(agentRoot,agent.id,oldRevision+'.md'),bytes=regular(oldPath);if(hash(bytes)!==oldHash)throw Error('Agent digest mismatch: '+oldPath);
   const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),match=text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);if(!match)throw Error('Invalid Agent Markdown');const fields={};for(const line of match[1].split(/\r?\n/)){const m=line.match(/^([a-z_]+):\s*(.*)$/);if(!m||Object.hasOwn(fields,m[1]))throw Error('Invalid Agent frontmatter');fields[m[1]]=m[1]==='kind'?m[2]:JSON.parse(m[2]);}
   if(fields.agent_id!==agent.id||fields.revision!==oldRevision||fields.kind!=='project'||typeof fields.name!=='string'||(fields.description!==null&&typeof fields.description!=='string'))throw Error('Agent identity mismatch');
   const caps=fields.capabilities;if(!caps||typeof caps.readFiles!=='boolean'||typeof caps.writeFiles!=='boolean')throw Error('Invalid Agent file capabilities');
   revision++;const capabilities={readFiles:caps.readFiles,writeFiles:caps.writeFiles};const content=['---','agent_id: '+JSON.stringify(agent.id),'revision: '+revision,'kind: project','name: '+JSON.stringify(fields.name),'description: '+JSON.stringify(fields.description),'capabilities: '+JSON.stringify(capabilities),'---',''].join('\n')+'\n'+match[2];
   const newPath=path.resolve(agentRoot,agent.id,revision+'.md');if(fs.existsSync(newPath))throw Error('Candidate version already exists: '+newPath);
   const v={agentId:agent.id,oldRevision,newRevision:revision,oldPath,newPath,oldSha256:oldHash,newSha256:hash(content),name:fields.name,description:fields.description,content};versions.push(v);mapped.set(agent.id+':'+oldRevision,v);
  }const v=mapped.get(agent.id+':'+agent.revision);if(v.name!==agent.name||v.description!==agent.description)throw Error('Agent index mismatch');agent.revision=v.newRevision;agent.content_sha256=v.newSha256;}
  for(const s of target.sessions){if(!s.agent_id)continue;const old=JSON.parse(s.agent_snapshot_json),v=mapped.get(s.agent_id+':'+old.revision);s.agent_snapshot_json=JSON.stringify({agentId:s.agent_id,revision:v.newRevision,kind:'project',projectId:null,contentSha256:v.newSha256,name:v.name,description:v.description});}
  for(const table of TABLES)target[table].sort((a,b)=>canonical(a).localeCompare(canonical(b),'en'));
  const archivedFiles=[];for(const agent of source.agents){if(!/^[A-Za-z0-9_-]{1,160}$/.test(agent.id))throw Error('Unsafe historical Agent ID');const dir=path.resolve(agentRoot,agent.id);for(const name of fs.readdirSync(dir)){if(!/^[1-9][0-9]*\.md$/.test(name))continue;const file=path.join(dir,name);archivedFiles.push({path:file,name:agent.id+'-'+name,sha256:hash(regular(file))});}}
  checkNative(target);const validation=new Database(':memory:');try{validation.pragma('foreign_keys=OFF');fill(validation,target,sql);}finally{validation.close();}
  const summary={status:'ready',database:file,sourceSchemaSha256:schemaHash(db),sourceDataSha256:digest(source),targetSchemaSha256:targetHash,targetSqlSha256:hash(sql),targetDataSha256:digest(target),sourceCounts:Object.fromEntries(Object.entries(source).map(([k,v])=>[k,v.length])),targetCounts:Object.fromEntries(Object.entries(target).map(([k,v])=>[k,v.length])),retiredAgents,archivedFiles,versions:versions.map(({content,...v})=>v)};
  return {...summary,planSha256:digest(summary),target,sql,versions};
 }finally{db.close();}
}
function publicPlan(plan){const {target,sql,versions,...rest}=plan;return {...rest,...(versions?{versions:versions.map(({content,...v})=>v)}:{})};}
async function apply(file,expectedPlan,options={}){
 const connectionCheck=options.connectionCheck??checkConnections;connectionCheck(file);const plan=buildPlan(file,options);if(plan.status==='current')return publicPlan(plan);if(plan.planSha256!==expectedPlan)throw Error('Plan changed; rerun read-only preflight');
 const lock=file+'.migration-lock';fs.mkdirSync(lock,{mode:0o700});let db,transaction=false,archive;
 try{
  connectionCheck(file);db=new Database(file,{fileMustExist:true,timeout:0});if(schemaHash(db)!==plan.sourceSchemaSha256||digest(data(db))!==plan.sourceDataSha256)throw Error('Database changed before backup');
  archive=file+'.current-schema-'+crypto.randomUUID();fs.mkdirSync(archive,{mode:0o700});const backup=path.join(archive,'before.sqlite');await db.backup(backup);const b=new Database(backup,{readonly:true});try{if(schemaHash(b)!==plan.sourceSchemaSha256||digest(data(b))!==plan.sourceDataSha256||b.pragma('integrity_check',{simple:true})!=='ok')throw Error('Backup verification failed');}finally{b.close();}fs.chmodSync(backup,0o400);const backupFd=fs.openSync(backup,'r');try{fs.fsyncSync(backupFd);}finally{fs.closeSync(backupFd);}syncDir(archive);
  for(const f of plan.archivedFiles){const bytes=regular(f.path);if(hash(bytes)!==f.sha256)throw Error('Agent changed before backup');writeExclusive(path.join(archive,f.name),bytes);}
  const manifest={...publicPlan(plan),backupSha256:hash(regular(backup)),backup,createdAt:new Date().toISOString()};writeExclusive(path.join(archive,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');syncDir(path.dirname(file));
  db.pragma('foreign_keys=OFF');db.exec('BEGIN EXCLUSIVE');transaction=true;
  if(schemaHash(db)!==plan.sourceSchemaSha256||digest(data(db))!==plan.sourceDataSha256)throw Error('Database changed before transaction');
  for(const f of plan.archivedFiles)if(hash(regular(f.path))!==f.sha256)throw Error('Historical Agent source changed');
  for(const v of plan.versions){if(hash(regular(v.oldPath))!==v.oldSha256)throw Error('Agent source changed');writeExclusive(v.newPath,v.content);}
  for(const object of schema(db).filter(o=>o.type==='trigger'||o.type==='view'))db.exec('DROP '+object.type.toUpperCase()+' '+quote(object.name));
  for(const table of schema(db).filter(o=>o.type==='table'))db.exec('DROP TABLE '+quote(table.name));
  fill(db,plan.target,plan.sql);if(schemaHash(db)!==plan.targetSchemaSha256)throw Error('Target schema mismatch');
  for(const v of plan.versions)if(hash(regular(v.newPath))!==v.newSha256||hash(regular(v.oldPath))!==v.oldSha256)throw Error('Agent file verification failed');
  options.beforeCommit?.(db);db.exec('COMMIT');transaction=false;db.pragma('foreign_keys=ON');
  if(db.pragma('foreign_key_check').length||db.pragma('integrity_check',{simple:true})!=='ok'||digest(data(db))!==plan.targetDataSha256)throw Error('Post-commit verification failed; retain backup for inspection');
  return {status:'migrated',archive,backupSha256:manifest.backupSha256,planSha256:plan.planSha256,targetSchemaSha256:plan.targetSchemaSha256,targetDataSha256:plan.targetDataSha256,counts:plan.targetCounts};
 }catch(error){if(transaction)db.exec('ROLLBACK');error.archive=archive;throw error;}finally{db?.close();fs.rmdirSync(lock);syncDir(path.dirname(file));}
}
module.exports={buildPlan,apply,publicPlan,schemaHash,data,digest,checkConnections};
if(require.main===module){(async()=>{const args=process.argv.slice(2),file=path.resolve(args[0]??path.join(ROOT,'.data','ai-workspace-v5.sqlite'));if(args.length>3||args[1]&&args[1]!=='--apply')throw Error('Usage: node scripts/migrate-current-schema.cjs [database] [--apply PLAN_SHA256]');checkConnections(file);const result=args[1]==='--apply'?await apply(file,args[2]):publicPlan(buildPlan(file));console.log(JSON.stringify(result,null,2));})().catch(error=>{console.error(JSON.stringify({status:'blocked',error:error.message,archive:error.archive??null},null,2));process.exitCode=1;});}
