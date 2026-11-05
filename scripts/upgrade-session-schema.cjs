#!/usr/bin/env node
// Explicit offline upgrade only. Never imported by application bootstrap.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process'),Database=require('better-sqlite3');
const files=['core-schema.sql','bot-schema.sql','agent-binding-schema.sql','role-schema.sql','workspace-schema.sql'];
const readSchema=directory=>files.map(file=>fs.readFileSync(path.join(directory,file),'utf8')).join('\n');
const targetSQL=readSchema(path.join(__dirname,'../src/infrastructure/database'));
const legacySQL=readSchema(path.join(__dirname,'historical-schema'));
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const normalize=value=>(value??'').replaceAll('"','').replace(/\s+/g,' ').trim().replace(/;$/,'');
const objects=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
const columns=(db,table)=>db.prepare('PRAGMA table_info('+quote(table)+')').all().map(row=>row.name);
const digestJSON=value=>hash(JSON.stringify(value,(_key,v)=>typeof v==='bigint'?{integer:v.toString()}:Buffer.isBuffer(v)?{blob:v.toString('base64')}:v));
function rowDigest(db,table,names=columns(db,table)){
 const rows=db.prepare('SELECT '+names.map(quote).join(',')+' FROM '+quote(table)).safeIntegers().raw().all();
 return {columns:names,count:rows.length,sha256:digestJSON(rows.map(row=>digestJSON(row)).sort())};
}
function snapshot(db){return objects(db).filter(item=>item.type==='table').map(item=>({name:item.name,...rowDigest(db,item.name)}));}
function fingerprint(db){return digestJSON({schema:objects(db),tables:snapshot(db)});}
function sameSchema(db,expected){return digestJSON(objects(db).map(x=>({...x,sql:normalize(x.sql)})))===digestJSON(objects(expected).map(x=>({...x,sql:normalize(x.sql)})));}
function healthy(db){if(db.pragma('integrity_check').some(row=>row.integrity_check!=='ok'))throw Error('数据库完整性检查失败');if(db.pragma('foreign_key_check').length)throw Error('数据库外键检查失败');}
function reference(sql){const db=new Database(':memory:');try{db.exec(sql);return db;}catch(error){db.close();throw error;}}
function copyRows(source,destination,table){
 const names=columns(source,table).filter(name=>columns(destination,table).includes(name));
 const insert=destination.prepare('INSERT INTO '+quote(table)+'('+names.map(quote).join(',')+') VALUES('+names.map(()=>'?').join(',')+')');
 for(const row of source.prepare('SELECT '+names.map(quote).join(',')+' FROM '+quote(table)).safeIntegers().raw().iterate())try{insert.run(...row);}catch(error){const index=names.indexOf('id');if(index>=0)error.migrationRowId=String(row[index]);throw error;}
}
function validateRows(source,target){
 target.pragma('foreign_keys=OFF');
 const triggers=objects(target).filter(x=>x.type==='trigger');for(const x of triggers)target.exec('DROP TRIGGER '+quote(x.name));
 const conflicts=[];
 for(const row of source.prepare('SELECT id,status,state,ended_at FROM sessions').all()){
  if((row.status==='closed')!==(row.ended_at!==null)||(row.state==='ended'&&row.ended_at===null))conflicts.push({table:'sessions',id:row.id,reason:'LIFECYCLE_CONFLICT'});
  if(['starting','running','interrupting','unavailable'].includes(row.state))conflicts.push({table:'sessions',id:row.id,reason:'UNRESOLVED_RUNTIME'});
 }
 if(conflicts.length)return conflicts;
 for(const item of objects(target).filter(x=>x.type==='table')){
  try{copyRows(source,target,item.name);}catch(error){conflicts.push({table:item.name,...(error.migrationRowId?{id:error.migrationRowId}:{}),reason:error.code??'COPY_FAILED'});}
 }
 if(conflicts.length)return conflicts;
 for(const row of target.prepare("SELECT s.id FROM sessions s JOIN projects p ON p.id=s.project_id WHERE s.native_ref_json IS NOT NULL AND json_extract(s.native_ref_json,'$.cwd') IS NOT p.root_path").all())conflicts.push({table:'sessions',id:row.id,reason:'NATIVE_CWD_CONFLICT'});
 for(const row of target.prepare("SELECT s.id FROM sessions s JOIN workspace_sessions w ON json_extract(s.native_ref_json,'$.sessionId')=json_extract(w.native_ref_json,'$.sessionId') OR json_extract(s.native_ref_json,'$.sessionFile')=json_extract(w.native_ref_json,'$.sessionFile')").all())conflicts.push({table:'sessions',id:row.id,reason:'CROSS_SCOPE_NATIVE_IDENTITY'});
 for(const row of target.pragma('foreign_key_check'))conflicts.push({table:row.table,reason:'FOREIGN_KEY_CONFLICT'});
 for(const item of objects(target).filter(x=>x.type==='table')){
  const names=columns(target,item.name).filter(name=>columns(source,item.name).includes(name));
  if(digestJSON(rowDigest(source,item.name,names))!==digestJSON(rowDigest(target,item.name,names)))conflicts.push({table:item.name,reason:'PRESERVATION_FAILED'});
 }
 for(const trigger of triggers)target.exec(trigger.sql);
 if(!conflicts.length)healthy(target);
 return conflicts;
}
function inspect(db){
 healthy(db);const target=reference(targetSQL),legacy=reference(legacySQL);
 try{
  const targetSha256=hash(targetSQL),sourceSha256=fingerprint(db);
  if(sameSchema(db,target))return {state:'current',sourceSha256,targetSha256,tables:snapshot(db)};
  if(!sameSchema(db,legacy))return {state:'blocked',sourceSha256,targetSha256,conflicts:[{reason:'UNSUPPORTED_SCHEMA'}]};
  const conflicts=validateRows(db,target);
  return {state:conflicts.length?'blocked':'ready',sourceSha256,targetSha256,tables:snapshot(db),conflicts,retired:{tables:['session_memories'],columns:{sessions:['session_memory_id','state','status'],workspace_sessions:['session_memory_id']}},rebuilt:['agents','sessions','workspace_sessions']};
 }finally{target.close();legacy.close();}
}
function checkOffline(file,ownConnection=false){
 for(const candidate of [file,file+'-wal',file+'-shm']){
  if(!fs.existsSync(candidate))continue;
  const r=spawnSync('lsof',['-t',candidate],{encoding:'utf8'});
  if(r.error||![0,1].includes(r.status))throw Error('无法检查数据库连接；未执行迁移');
  if(r.stdout.trim().split(/\s+/).filter(Boolean).some(pid=>!ownConnection||pid!==String(process.pid)))throw Error('数据库仍有其他打开连接；请自行关闭服务后重试，未执行迁移');
 }
}
function syncFile(file){const fd=fs.openSync(file,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function rebuild(db){
 const target=reference(targetSQL);
 try{
  const before=snapshot(db),all=objects(db),expected=objects(target),rebuilt=['agents','sessions','workspace_sessions'];
  // Remove reviewed triggers first: historical imports must not activate current insert/adoption rules.
  for(const item of all.filter(x=>x.type==='trigger'))db.exec('DROP TRIGGER '+quote(item.name));
  for(const table of rebuilt){
   const definition=expected.find(x=>x.type==='table'&&x.name===table),temporary='session_upgrade_'+table;
   db.exec(definition.sql.replace(new RegExp('^CREATE TABLE '+table+'\\s*\\('),'CREATE TABLE '+temporary+' ('));
   const names=columns(db,table).filter(name=>columns(target,table).includes(name));
   db.exec('INSERT INTO '+quote(temporary)+'('+names.map(quote).join(',')+') SELECT '+names.map(quote).join(',')+' FROM '+quote(table));
   db.exec('DROP TABLE '+quote(table));
   db.exec('ALTER TABLE '+quote(temporary)+' RENAME TO '+quote(table));
  }
  db.exec('DROP TABLE session_memories');
  for(const item of expected.filter(x=>x.type==='index'&&rebuilt.includes(x.tbl_name)))db.exec(item.sql);
  for(const item of expected.filter(x=>x.type==='trigger'))db.exec(item.sql);
  if(!sameSchema(db,target))throw Error('升级后Schema与目标不同');
  for(const table of before.filter(x=>x.name!=='session_memories')){
   const names=table.columns.filter(name=>columns(target,table.name).includes(name));
   // The caller separately checks against the durable source archive.
   if(rowDigest(db,table.name,names).count!==table.count)throw Error('历史行数改变：'+table.name);
  }
  healthy(db);
 }finally{target.close();}
}
async function upgradeSessionSchema(file,options={}){
 file=path.resolve(file);
 const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('数据库必须是独立普通文件，拒绝符号/硬链接');
 const preview=new Database(file,{readonly:true,fileMustExist:true});let report;
 try{report=preview.transaction(()=>inspect(preview))();}finally{preview.close();}
 if(!options.apply||report.state==='current')return report;
 if(report.state!=='ready')throw Error('预检阻止升级：'+JSON.stringify(report.conflicts));
 if(options.expectSource!==report.sourceSha256||options.expectTarget!==report.targetSha256)throw Error('需要与预检一致的来源和目标SHA-256确认');
 const lock=file+'.session-upgrade-lock';fs.mkdirSync(lock,{mode:0o700});let db,bundle;
 try{
  if(options.checkOffline!==false)checkOffline(file);
  db=new Database(file,{fileMustExist:true,timeout:0});db.pragma('synchronous=FULL');
  if(fingerprint(db)!==report.sourceSha256)throw Error('来源已变化，请重新预检');
  bundle=file+'.session-upgrade-'+crypto.randomUUID();fs.mkdirSync(bundle,{mode:0o700});
  const backup=path.join(bundle,'before.sqlite');await db.backup(backup);syncFile(backup);
  const archived=new Database(backup,{readonly:true,fileMustExist:true});
  try{healthy(archived);if(fingerprint(archived)!==report.sourceSha256)throw Error('归档与预检来源不一致');}finally{archived.close();}
  const backupSha256=hash(fs.readFileSync(backup)),manifest={version:1,createdAt:new Date().toISOString(),...report,backupSha256,backupFile:'before.sqlite'};
  const manifestFile=path.join(bundle,'manifest.json');fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});syncFile(manifestFile);fs.chmodSync(backup,0o400);fs.chmodSync(manifestFile,0o400);syncFile(backup);syncFile(manifestFile);syncFile(bundle);syncFile(path.dirname(bundle));
  db.pragma('foreign_keys=OFF');db.exec('BEGIN EXCLUSIVE');
  try{
   if(options.checkOffline!==false)checkOffline(file,true);
   if(fingerprint(db)!==report.sourceSha256)throw Error('事务开始时来源已变化，请重新预检');
   if(hash(fs.readFileSync(backup))!==backupSha256)throw Error('归档文件摘要变化');
   rebuild(db);
   const old=new Database(backup,{readonly:true,fileMustExist:true});
   try{for(const table of report.tables.filter(x=>x.name!=='session_memories')){const names=table.columns.filter(name=>columns(db,table.name).includes(name));if(digestJSON(rowDigest(old,table.name,names))!==digestJSON(rowDigest(db,table.name,names)))throw Error('保留列值改变：'+table.name);}}finally{old.close();}
   if(options.beforeCommit)options.beforeCommit(db);
   db.exec('COMMIT');
  }catch(error){if(db.inTransaction)db.exec('ROLLBACK');throw error;}finally{db.pragma('foreign_keys=ON');}
  return {...report,state:'migrated',archive:bundle,backupSha256};
 }catch(error){if(bundle)error.message+='；归档保留于 '+bundle;throw error;}finally{db?.close();fs.rmdirSync(lock);}
}
module.exports={upgradeSessionSchema,inspect};
if(require.main===module){
 const args=process.argv.slice(2),value=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
 const allowed=new Set(['--apply','--expect-source','--expect-target']);let file;
 try{for(let i=0;i<args.length;i++){if(args[i].startsWith('--')){if(!allowed.has(args[i]))throw Error('未知选项');if(args[i]!=='--apply'){if(!/^[a-f0-9]{64}$/.test(args[i+1]??''))throw Error('摘要参数无效');i++;}}else if(file)throw Error('只允许一个数据库路径');else file=args[i];}
 upgradeSessionSchema(file??path.join(__dirname,'../.data/ai-workspace-v5.sqlite'),{apply:args.includes('--apply'),expectSource:value('--expect-source'),expectTarget:value('--expect-target')}).then(result=>{console.log(JSON.stringify(result,null,2));if(result.state==='blocked')process.exitCode=2;}).catch(error=>{console.error(error.message);process.exitCode=1;});}catch(error){console.error(error.message);process.exitCode=1;}
}
