require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process'),Database=require('better-sqlite3');
const {targetSchema}=require('../src/infrastructure/database/schema.server.ts');
const {matchesTargetSchema}=require('../src/infrastructure/database/schema-compatibility.ts');

test('current schema contains exactly seven business tables and only project Agent purposes',()=>{
 const db=new Database(':memory:');try{
  db.exec(targetSchema);
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name),['agents','mcps','projects','sessions','workspace_projects','workspace_sessions','workspaces']);
  assert.equal(matchesTargetSchema(db,targetSchema),true);
  assert.throws(()=>db.prepare("INSERT INTO agents(id,name,kind,extension_json,policy_json,revision,status,created_at,updated_at) VALUES('a','A','coordinator','{}','{}',1,'active','now','now')").run(),/CHECK/);
  const columns=table=>db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name);
  assert(!columns('agents').includes('bot_id'));
  assert(!columns('sessions').some(name=>['bot_conversation_id','participant_name','assignment','collaboration_state','bot_joined_at'].includes(name)));
 }finally{db.close();}
});
test('schema preflight refuses retired tables, columns and triggers without changing their contents',()=>{
 for(const change of ["CREATE TABLE retired_feature_data(id TEXT PRIMARY KEY,body TEXT);INSERT INTO retired_feature_data VALUES('history','retain original bytes')","ALTER TABLE sessions ADD COLUMN retired_parent_id TEXT","CREATE TRIGGER retired_guard BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT,'retain');END"]){
  const db=new Database(':memory:');try{db.exec(targetSchema);db.exec(change);const before=db.serialize();assert.equal(matchesTargetSchema(db,targetSchema),false);assert.deepEqual(db.serialize(),before);}finally{db.close();}
 }
});
test('database initialization opens an incompatible historical file read-only and never initializes or migrates it',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'schema-retirement-')),file=path.join(root,'.data','ai-workspace-v5.sqlite');fs.mkdirSync(path.dirname(file));
 try{
  const fixture=new Database(file);fixture.exec(targetSchema);fixture.exec("CREATE TABLE retired_feature_data(id TEXT PRIMARY KEY,body TEXT);INSERT INTO retired_feature_data VALUES('history','retain original bytes')");fixture.close();const before=fs.readFileSync(file);
  const packaged=path.join(root,'runtime','database');fs.mkdirSync(packaged,{recursive:true});for(const name of ['core-schema.sql','role-schema.sql','workspace-schema.sql'])fs.copyFileSync(path.join(__dirname,'../src/infrastructure/database',name),path.join(packaged,name));
  const modulePath=path.join(__dirname,'../src/infrastructure/database/database.server.ts');
  const script=`const assert=require('node:assert/strict');const {database,schemaCompatible,assertSchemaCompatible}=require(${JSON.stringify(modulePath)});assert.equal(schemaCompatible,false);assert.equal(database.readonly,true);assert.throws(assertSchemaCompatible,e=>e.code==='SCHEMA_INCOMPATIBLE');assert.equal(database.prepare('SELECT body FROM retired_feature_data').get().body,'retain original bytes');assert.throws(()=>database.exec("DELETE FROM retired_feature_data"),e=>e.code==='SQLITE_READONLY');database.close();`;
  execFileSync(process.execPath,['-r',path.join(__dirname,'register.cjs'),'-e',script],{cwd:root,env:{...process.env,NEXT_PHASE:'',AI_WORKSPACE_DB_PATH:''},stdio:'pipe'});
  assert.deepEqual(fs.readFileSync(file),before);assert(!fs.existsSync(file+'-wal'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
