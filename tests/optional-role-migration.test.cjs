require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),Database=require('better-sqlite3');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const {targetSchema}=require('../src/infrastructure/database/schema.server.ts');
const script=path.resolve('scripts/migrate-optional-session-role.cjs');
test('offline migration preserves existing records and allows role-less session inserts',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'role-migration-')),file=path.join(dir,'test.sqlite');
 try {
  const db=new Database(file);db.exec(targetSchema);
  db.exec("DROP TRIGGER session_role_insert; CREATE TRIGGER session_role_insert BEFORE INSERT ON sessions WHEN NEW.agent_id IS NULL OR NOT EXISTS(SELECT 1 FROM agents WHERE id=NEW.agent_id AND kind='project' AND status='active' AND revision>=json_extract(NEW.agent_snapshot_json,'$.revision')) OR json_extract(NEW.agent_snapshot_json,'$.agentId') IS NOT NEW.agent_id OR json_extract(NEW.agent_snapshot_json,'$.contentSha256') IS NULL BEGIN SELECT RAISE(ABORT,'project role required'); END;");
  db.exec("INSERT INTO projects VALUES('p','P',NULL,'code','/tmp','active','now','now')");
  const context=JSON.stringify({summary:'keep',goal:'',constraints:[],facts:[],decisions:[],nextActions:[],outputs:[]});
  db.prepare("INSERT INTO session_memories(id,project_id,source_template_id,title,context_json,draft_json,last_reviewed_entry_id,created_at,updated_at) VALUES('m','p',NULL,'memory',?,NULL,NULL,'now','now')").run(context);db.close();
  const preview=spawnSync(process.execPath,[script,file],{encoding:'utf8'});assert.equal(preview.status,0,preview.stderr);assert.equal(JSON.parse(preview.stdout).state,'legacy');
  const result=spawnSync(process.execPath,[script,file,'--apply'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.ok(fs.existsSync(JSON.parse(result.stdout).backup));
  const after=new Database(file);after.pragma('foreign_keys=ON');assert.equal(after.prepare('SELECT context_json FROM session_memories').get().context_json,context);
  after.prepare("INSERT INTO sessions(id,session_memory_id,project_id,purpose,state,created_at,updated_at) VALUES('s','m','p','test','idle','now','now')").run();
  assert.equal(after.prepare('SELECT agent_id FROM sessions').get().agent_id,null);assert.deepEqual(after.pragma('foreign_key_check'),[]);after.close();
  const again=spawnSync(process.execPath,[script,file,'--apply'],{encoding:'utf8'});assert.equal(again.status,0,again.stderr);assert.equal(JSON.parse(again.stdout).state,'already-migrated');
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
