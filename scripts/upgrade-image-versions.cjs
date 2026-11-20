#!/usr/bin/env node
'use strict';
// Explicit, reviewed upgrade only. Application startup never imports this file.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const Database = require('better-sqlite3');
const schemaQuery = "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name";
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? {integer:String(v)} : v);
const quote = value => '"' + value.replaceAll('"', '""') + '"';
function assertPath(filename) {
  for (let current=filename;;current=path.dirname(current)) {
    if (fs.lstatSync(current).isSymbolicLink()) throw Error('Symbolic links are not allowed: '+current);
    if (current===path.dirname(current)) break;
  }
  if(!fs.statSync(filename).isFile())throw Error('Database must be a regular file');
}
function noConnections(filename) {
  const files=[filename,filename+'-wal',filename+'-shm'].filter(file=>fs.existsSync(file));
  const result=spawnSync('lsof',['-F','p','--',...files],{encoding:'utf8'});
  if(result.error || ![0,1].includes(result.status) || result.stderr.trim())throw Error('Cannot verify database connections: '+(result.error?.message || result.stderr));
  const pids=[...new Set(result.stdout.split('\n').filter(line=>/^p\d+$/.test(line)).map(line=>Number(line.slice(1))))].filter(pid=>pid!==process.pid);
  if(pids.length)throw Error('Database is open in processes '+pids.join(', ')+'. No service was stopped.');
}
function healthy(db) {
  if(db.pragma('integrity_check',{simple:true})!=='ok' || db.pragma('foreign_key_check').length)throw Error('Database integrity check failed');
}
function definitions() {
  const root=path.resolve(__dirname,'..');
  const directory=fs.existsSync(path.join(root,'runtime/database'))?path.join(root,'runtime/database'):path.join(root,'src/infrastructure/database');
  const common=['core-schema.sql','role-schema.sql','workspace-schema.sql'].map(name=>fs.readFileSync(path.join(directory,name),'utf8')).join('\n');
  return {common,previous:fs.readFileSync(path.join(directory,'image-schema-v1.sql'),'utf8'),target:fs.readFileSync(path.join(directory,'image-schema.sql'),'utf8')};
}
function expectedSchema(sql) {
  const db=new Database(':memory:');
  try {db.exec(sql);return db.prepare(schemaQuery).all();} finally {db.close();}
}
const normalize = rows => rows.map(row=>({...row,sql:(row.sql || '').replace(/^CREATE TABLE "([A-Za-z_][A-Za-z0-9_]*)"/,'CREATE TABLE $1').replace(/\s+/g,' ').trim()}));
function snapshot(db, projection) {
  const schema=db.prepare(schemaQuery).all();
  const columns=projection || Object.fromEntries(schema.filter(row=>row.type==='table').map(row=>[row.name,db.prepare('PRAGMA table_xinfo('+quote(row.name)+')').all().map(column=>column.name)]));
  const tables=Object.fromEntries(Object.entries(columns).map(([name,fields])=>{
    const rows=db.prepare('SELECT '+fields.map(quote).join(',')+' FROM '+quote(name)).safeIntegers().raw().all().map(json).sort();
    return [name,{count:rows.length,sha256:digest(json(rows))}];
  }));
  return {columns,tables,rowsSha256:digest(json(tables)),schemaSha256:digest(json(normalize(schema)))};
}
function plan(filename) {
  filename=path.resolve(filename);assertPath(filename);
  const ddl=definitions();
  const previous=expectedSchema(ddl.common+'\n'+ddl.previous), target=expectedSchema(ddl.common+'\n'+ddl.target);
  const db=new Database(filename,{readonly:true,fileMustExist:true});
  try {
    healthy(db);
    const schema=normalize(db.prepare(schemaQuery).all());
    const current=json(schema)===json(normalize(target));
    if(!current && json(schema)!==json(normalize(previous)))throw Error('Source is not the exact supported previous three-table schema');
    const source=snapshot(db);
    const mappings=current?[]:db.prepare("SELECT id,task_id,role FROM image_assets WHERE availability='ready' AND source_asset_id IS NULL AND role IN ('reference','output') ORDER BY task_id,id").all().map(row=>({assetId:row.id,taskId:row.task_id,kind:row.role,rootAssetId:row.id,versionNumber:0,readyAt:null}));
    const details={version:1,filename,status:current?'current':'requires_explicit_version_upgrade',source,targetSchemaSha256:digest(json(normalize(target))),targetDdlSha256:digest(ddl.common+'\n'+ddl.target),mapping:'independent-originals-and-results',mappings};
    return {...details,planSha256:digest(json(details)),migrationExecuted:false};
  }finally{db.close();}
}
function flush(filename) {const fd=fs.openSync(filename,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function manifest(directory,name,value) {const filename=path.join(directory,name);fs.writeFileSync(filename,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o400});flush(filename);flush(directory);}
async function execute(filename,planSha256) {
  filename=path.resolve(filename);assertPath(filename);noConnections(filename);
  const initial=plan(filename);
  if(initial.planSha256!==planSha256)throw Error('Plan has changed; inspect again');
  if(initial.status==='current')return initial;
  const lock=filename+'.image-version-upgrade.lock';fs.mkdirSync(lock,{mode:0o700});
  let source,db,directory;
  try {
    noConnections(filename);
    source=new Database(filename,{readonly:true,fileMustExist:true});
    healthy(source);
    if(json(snapshot(source))!==json(initial.source))throw Error('Source changed before backup');
    directory=filename+'.image-version-upgrade-'+crypto.randomUUID();fs.mkdirSync(directory,{mode:0o700});
    const backupFile=path.join(directory,'before.sqlite');
    await source.backup(backupFile);source.close();source=null;
    const backup=new Database(backupFile,{fileMustExist:true});
    try {backup.pragma('journal_mode=DELETE');healthy(backup);if(json(snapshot(backup))!==json(initial.source))throw Error('Backup contents differ from source');}finally{backup.close();}
    flush(backupFile);fs.chmodSync(backupFile,0o400);flush(backupFile);
    const backupSha256=digest(fs.readFileSync(backupFile));
    manifest(directory,'manifest.json',{...initial,backupSha256,backedUpAt:new Date().toISOString()});flush(path.dirname(directory));
    noConnections(filename);
    const ddl=definitions();
    if(digest(ddl.common+'\n'+ddl.target)!==initial.targetDdlSha256)throw Error('Target DDL changed');
    const expected=expectedSchema(ddl.common+'\n'+ddl.target);
    db=new Database(filename,{fileMustExist:true,timeout:0});db.pragma('foreign_keys=ON');
    db.exec('BEGIN EXCLUSIVE');noConnections(filename);healthy(db);
    if(json(snapshot(db))!==json(initial.source))throw Error('Source changed after backup');
    const assetTable=expected.find(row=>row.type==='table' && row.name==='image_assets');
    db.exec(assetTable.sql.replace(/^CREATE TABLE image_assets\b/,'CREATE TABLE image_assets_version_upgrade'));
    const fields=initial.source.columns.image_assets;
    db.exec('INSERT INTO image_assets_version_upgrade ('+fields.map(quote).join(',')+') SELECT '+fields.map(quote).join(',')+' FROM image_assets');
    db.exec("UPDATE image_assets_version_upgrade SET root_asset_id=id,version_number=0 WHERE availability='ready' AND source_asset_id IS NULL AND role IN ('reference','output')");
    db.exec('DROP TABLE image_assets');
    db.exec('ALTER TABLE image_assets_version_upgrade RENAME TO image_assets');
    for(const object of expected)if(object.tbl_name==='image_assets' && object.type!=='table' && object.sql)db.exec(object.sql);
    if(json(normalize(db.prepare(schemaQuery).all()))!==json(normalize(expected)))throw Error('Target schema differs from application schema');
    const preserved=snapshot(db,initial.source.columns);
    if(preserved.rowsSha256!==initial.source.rowsSha256)throw Error('Original columns or rows changed');
    const mapped=db.prepare('SELECT id,task_id,role,root_asset_id,version_number,ready_at FROM image_assets WHERE root_asset_id IS NOT NULL ORDER BY task_id,id').all().map(row=>({assetId:row.id,taskId:row.task_id,kind:row.role,rootAssetId:row.root_asset_id,versionNumber:row.version_number,readyAt:row.ready_at}));
    if(json(mapped)!==json(initial.mappings))throw Error('Version mappings differ from approved plan');
    healthy(db);noConnections(filename);db.exec('COMMIT');db.close();db=null;
    const result={status:'migrated',migrationExecuted:true,filename,planSha256,backupDirectory:directory,backupSha256,originalRowsSha256:initial.source.rowsSha256,preservedRowCounts:Object.fromEntries(Object.entries(initial.source.tables).map(([name,value])=>[name,value.count])),mappedOriginals:mapped.filter(row=>row.kind==='reference').length,mappedResults:mapped.filter(row=>row.kind==='output').length,integrityCheck:'ok',foreignKeyErrors:0,completedAt:new Date().toISOString()};
    manifest(directory,'result.json',result);
    return result;
  }catch(error){if(db?.inTransaction)db.exec('ROLLBACK');if(directory)error.message+=' Backup retained at '+directory;throw error;}
  finally{source?.close();db?.close();fs.rmdirSync(lock);}
}
module.exports={plan,execute};
if(require.main===module){
  const args=process.argv.slice(2);
  const valid=args.length===1 || args.length===4 && args[1]==='--execute' && args[2]==='--plan-sha256' && /^[a-f0-9]{64}$/.test(args[3]);
  if(!valid){console.error('Usage: node scripts/upgrade-image-versions.cjs DATABASE [--execute --plan-sha256 HASH]');process.exitCode=1;}
  else Promise.resolve().then(()=>args.length===1?plan(args[0]):execute(args[0],args[3])).then(value=>console.log(JSON.stringify(value,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
