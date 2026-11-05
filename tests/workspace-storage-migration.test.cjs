require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { upgrade } = require('../scripts/migrate-workspace-storage.cjs');
const { createWorkspaceRepository } = require('../src/infrastructure/database/workspace-repository.ts');
const legacyMemory = `CREATE TABLE session_memories (
 id TEXT PRIMARY KEY,
 project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
 source_template_id TEXT REFERENCES session_memories(id) ON DELETE RESTRICT,
 title TEXT NOT NULL,
 context_json TEXT NOT NULL CHECK(json_valid(context_json) AND json_type(context_json)='object'),
 draft_json TEXT CHECK(draft_json IS NULL OR (json_valid(draft_json) AND json_type(draft_json)='object')),
 last_reviewed_entry_id TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(id, project_id),
 CHECK(project_id IS NOT NULL OR (source_template_id IS NULL AND draft_json IS NULL AND last_reviewed_entry_id IS NULL))
 );`;
function contextForLegacy(){return JSON.stringify({summary:'',goal:'',constraints:[],facts:[],decisions:[],nextActions:[],outputs:[]});}
function fixture() {
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-migration-'));
 const file = path.join(directory, 'history.sqlite');
 const db = new Database(file);
 let core = fs.readFileSync(path.join(__dirname, '../scripts/historical-schema/core-schema.sql'), 'utf8');
 core = core.replace(/CREATE TABLE session_memories \([\s\S]*?\n  \);/, legacyMemory)
   .replace('UPDATE OF project_id,workspace_id ON session_memories', 'UPDATE OF project_id ON session_memories')
   .replace(' OR NEW.workspace_id IS NOT OLD.workspace_id', '')
   .replaceAll(' AND workspace_id IS NULL', '');
 db.exec(core);
 for (const name of ['bot-schema.sql', 'agent-binding-schema.sql', 'role-schema.sql']) db.exec(fs.readFileSync(path.join(__dirname, '../scripts/historical-schema', name), 'utf8'));
 db.pragma('foreign_keys=ON');
 const context = JSON.stringify({summary:'保留摘要',goal:'',constraints:[],facts:[],decisions:[],nextActions:[],outputs:[]});
 db.exec("INSERT INTO projects VALUES('p','Project',NULL,'code','/tmp/example','active','now','now')");
 db.prepare("INSERT INTO session_memories VALUES('template',NULL,NULL,'Template',?,NULL,NULL,'now','now')").run(context);
 db.prepare("INSERT INTO session_memories VALUES('m','p','template','History',?,?, 'native-cursor','now','now')").run(context, JSON.stringify({keep:'legacy draft'}));
 db.prepare("INSERT INTO sessions(id,session_memory_id,project_id,purpose,state,native_ref_json,created_at,updated_at) VALUES('s','m','p','History','idle',?,'now','now')").run(JSON.stringify({kind:'pi',sessionId:'native-id',sessionFile:'/history/exact.jsonl',cwd:'/tmp/example'}));
 db.exec('CREATE INDEX memory_custom_idx ON session_memories(title)');
 db.close();
 return { file, directory, close: () => fs.rmSync(directory, { recursive:true, force:true }) };
}
test('offline upgrade retains every historical value, backup and custom objects; workspace constraints work and rerun is read-only', async () => {
 const f=fixture();
 try {
  const preview=await upgrade(f.file);assert.equal(preview.state,'legacy');
  const before=new Database(f.file,{readonly:true});const memory=before.prepare('SELECT * FROM session_memories ORDER BY id').all(),sessions=before.prepare('SELECT * FROM sessions').all();before.close();
  const result=await upgrade(f.file,{apply:true});assert.equal(result.state,'migrated');assert(fs.existsSync(result.backup));
  const db=new Database(f.file);db.pragma('foreign_keys=ON');
  try {
   assert.deepEqual(db.prepare('SELECT id,project_id,source_template_id,title,context_json,draft_json,last_reviewed_entry_id,created_at,updated_at FROM session_memories ORDER BY id').all(),memory);
   assert.deepEqual(db.prepare('SELECT * FROM sessions').all(),sessions);assert.equal(db.prepare('SELECT count(*) n FROM session_memories WHERE workspace_id IS NOT NULL').get().n,0);
   assert(db.prepare("SELECT 1 FROM sqlite_master WHERE name='memory_custom_idx'").get());
   const r=createWorkspaceRepository(db);assert.throws(()=>r.save(null,{name:'New workspace',projects:[{rootPath:'/tmp/example'}],defaultProjectIndex:0},'blocked'),e=>e.code==='SCHEMA_INCOMPATIBLE');
   const w={id:'w'},s={id:'ws',sessionMemoryId:'wm'};db.transaction(()=>{db.exec("INSERT INTO workspaces VALUES('w','Old target','wp','w','hash','now','now');INSERT INTO workspace_projects VALUES('wp','w','/tmp/example',0);");db.prepare("INSERT INTO session_memories(id,workspace_id,title,context_json,created_at,updated_at) VALUES('wm','w','Historical target',?,'now','now')").run(contextForLegacy());db.exec("INSERT INTO workspace_sessions(id,workspace_id,default_project_id,purpose,session_memory_id,create_request_key,create_request_sha256,created_at) VALUES('ws','w','wp','History','wm','ws','hash','now')");})();
   assert.equal(db.prepare("SELECT workspace_id FROM session_memories WHERE id='wm'").get().workspace_id,w.id);
   assert.throws(()=>db.prepare("UPDATE session_memories SET workspace_id=? WHERE id='m'").run(w.id),/immutable/);
   assert.throws(()=>db.prepare("UPDATE session_memories SET source_template_id=? WHERE id='m'").run(s.sessionMemoryId),/template/);
   assert.throws(()=>db.prepare("UPDATE workspace_sessions SET session_memory_id='m' WHERE id=?").run(s.id),/immutable/);
   assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
  }finally{db.close();}
  const bytes=fs.readFileSync(f.file);assert.equal((await upgrade(f.file,{apply:true})).state,'already-migrated');assert.deepEqual(fs.readFileSync(f.file),bytes);
  const backup=new Database(result.backup,{readonly:true});try{assert.equal(backup.prepare('PRAGMA table_info(session_memories)').all().some(c=>c.name==='workspace_id'),false);assert.deepEqual(backup.prepare('SELECT * FROM sessions').all(),sessions);}finally{backup.close();}
 }finally{f.close();}
});
test('migration failure rolls back the whole schema and preserves historical data',async()=>{
 const f=fixture();try{
  const db=new Database(f.file);db.exec('CREATE INDEX workspace_projects_owner_idx ON session_memories(title)');const memory=db.prepare('SELECT * FROM session_memories ORDER BY id').all(),schema=db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all();db.close();
  await assert.rejects(upgrade(f.file,{apply:true}),/already exists/);
  const after=new Database(f.file,{readonly:true});try{assert.deepEqual(after.prepare('SELECT * FROM session_memories ORDER BY id').all(),memory);assert.deepEqual(after.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all(),schema);}finally{after.close();}
 }finally{f.close();}
});
test('an open connection or partial workspace schema blocks migration without writes',async()=>{
 const f=fixture();try{
  const db=new Database(f.file);try{await assert.rejects(upgrade(f.file,{apply:true}),/打开连接/);db.exec('CREATE TABLE workspaces(id TEXT PRIMARY KEY)');}finally{db.close();}
  const bytes=fs.readFileSync(f.file);await assert.rejects(upgrade(f.file,{apply:true}),/不完整/);assert.deepEqual(fs.readFileSync(f.file),bytes);
 }finally{f.close();}
});
