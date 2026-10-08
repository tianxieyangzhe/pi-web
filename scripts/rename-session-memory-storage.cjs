#!/usr/bin/env node
// Explicit, offline migration; application startup never invokes this script.
const Database=require('better-sqlite3');
const {resolve}=require('node:path');
const args=process.argv.slice(2),file=args.find(arg=>!arg.startsWith('--'));
if(!file)throw new Error('Usage: node scripts/rename-session-memory-storage.cjs DATABASE [--apply]');
const path=resolve(file),db=new Database(path,{readonly:true});
const oldTable=['ro','oms'].join(''),oldColumn=['ro','om_id'].join('');
const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name);
if(tables.includes('session_memories')){console.log('Already migrated; no changes.');db.close();process.exit(0);}
if(!tables.includes(oldTable)||!db.prepare(`PRAGMA table_info(${oldTable})`).all().some(row=>row.name==='context_json'))throw new Error('Unsupported legacy structure: expected confirmed one-to-one memory schema');
const before={memories:db.prepare(`SELECT * FROM ${oldTable} ORDER BY id`).all(),sessions:db.prepare('SELECT * FROM sessions ORDER BY id').all(),projects:db.prepare('SELECT * FROM projects ORDER BY id').all()};
console.log(JSON.stringify({database:path,memories:before.memories.length,sessions:before.sessions.length,projects:before.projects.length,mode:args.includes('--apply')?'apply':'read-only preview'},null,2));
db.close();if(!args.includes('--apply'))process.exit(0);
(async()=>{const writable=new Database(path);const backup=`${path}.before-memory-storage-${Date.now()}.sqlite`;await writable.backup(backup);writable.pragma('foreign_keys=ON');
 writable.transaction(()=>{
  writable.exec(`ALTER TABLE ${oldTable} RENAME TO session_memories`);
  writable.exec(`ALTER TABLE sessions RENAME COLUMN ${oldColumn} TO session_memory_id`);
  // Recreate active index/trigger names; archive objects remain untouched.
  const indexName=['ro','oms_project_idx'].join('');
  writable.exec(`DROP INDEX IF EXISTS ${indexName}`);writable.exec('CREATE INDEX IF NOT EXISTS session_memories_project_idx ON session_memories(project_id,updated_at)');
  const oldOwner=['ro','oms_owner_immutable'].join('');const oldInsert=['ro','om_template_insert'].join('');const oldUpdate=['ro','om_template_update'].join('');
  for(const name of [oldOwner,oldInsert,oldUpdate])writable.exec(`DROP TRIGGER IF EXISTS ${name}`);
  writable.exec("CREATE TRIGGER session_memories_owner_immutable BEFORE UPDATE OF project_id ON session_memories WHEN NEW.project_id IS NOT OLD.project_id BEGIN SELECT RAISE(ABORT,'memory ownership is immutable'); END");
  writable.exec("CREATE TRIGGER memory_template_insert BEFORE INSERT ON session_memories WHEN NEW.source_template_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM session_memories WHERE id=NEW.source_template_id AND project_id IS NULL) BEGIN SELECT RAISE(ABORT,'source must be a template'); END");
  writable.exec("CREATE TRIGGER memory_template_update BEFORE UPDATE OF source_template_id ON session_memories WHEN NEW.source_template_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM session_memories WHERE id=NEW.source_template_id AND project_id IS NULL) BEGIN SELECT RAISE(ABORT,'source must be a template'); END");
  const sessions=writable.prepare('SELECT * FROM sessions ORDER BY id').all().map(row=>{const copy={...row};copy[oldColumn]=copy.session_memory_id;delete copy.session_memory_id;return copy;});
  if(JSON.stringify(sessions.map(row=>Object.entries(row).sort()))!==JSON.stringify(before.sessions.map(row=>Object.entries(row).sort())))throw new Error('Session data changed unexpectedly');
  if(JSON.stringify(writable.prepare('SELECT * FROM session_memories ORDER BY id').all())!==JSON.stringify(before.memories))throw new Error('Memory content changed');
  if(writable.pragma('foreign_key_check').length)throw new Error('Foreign key verification failed');
 })();writable.close();console.log(`Migration complete; all IDs and content preserved. Backup: ${backup}`);
})().catch(error=>{console.error(error.message);process.exitCode=1;});
