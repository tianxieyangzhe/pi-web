#!/usr/bin/env node
// Offline, explicit migration: replace only the legacy session INSERT trigger.
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const Database = require('better-sqlite3');
const file = path.resolve(process.argv[2] || '.data/ai-workspace-v5.sqlite');
const apply = process.argv.includes('--apply');
const schema = fs.readFileSync(path.join(__dirname, '../src/infrastructure/database/role-schema.sql'), 'utf8');
const target = schema.split('\n').find(line => line.startsWith('CREATE TRIGGER session_role_insert '));
function checkOffline() {
  for (const candidate of [file, `${file}-wal`, `${file}-shm`]) {
    if (!fs.existsSync(candidate)) continue;
    const result = spawnSync('lsof', ['-t', candidate], {encoding:'utf8'});
    if (result.error || (result.status !== 0 && result.status !== 1)) throw new Error(`无法检查数据库连接：${candidate}`);
    const pids = result.stdout.trim();
    if (pids) throw new Error(`数据库仍有打开连接（PID ${pids.replace(/\s+/g, ', ')}），请先关闭连接；未修改数据库。`);
  }
}
function trigger(db) { return db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='session_role_insert' AND tbl_name='sessions'").get()?.sql; }
function normalized(sql) {return sql?.trim().replace(/;$/, '').replace(/\s+/g, ' ');}
function validate(db) {
  const sql = trigger(db);
  if (normalized(sql) === normalized(target)) return 'already-migrated';
  if (!sql || !/WHEN\s+NEW\.agent_id\s+IS\s+NULL\s+OR\s+NOT\s+EXISTS/i.test(sql) || !sql.includes("project role required")) throw new Error('角色触发器与预期旧版不符；未修改数据库。');
  if (db.pragma('integrity_check').some(row=>row.integrity_check!=='ok') || db.pragma('foreign_key_check').length) throw new Error('数据库完整性或外键检查失败；未修改数据库。');
  return 'legacy';
}
async function main() {
  if (!fs.existsSync(file)) throw new Error('数据库文件不存在');
  if (apply) checkOffline();
  const db = new Database(file, {readonly:!apply,fileMustExist:true});
  try {
    db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 1000');
    const before = validate(db);
    if (!apply || before === 'already-migrated') { console.log(JSON.stringify({mode:apply?'apply':'preview',state:before})); return; }
    const backup = `${file}.pre-optional-role-${new Date().toISOString().replace(/[:.]/g,'-')}.bak`;
    await db.backup(backup);
    db.transaction(()=>{
      if (validate(db)!=='legacy') throw new Error('数据库触发器已变化；事务已回滚。');
      db.exec('DROP TRIGGER session_role_insert');
      db.exec(target);
      if (normalized(trigger(db))!==normalized(target)) throw new Error('新触发器校验失败；事务已回滚。');
      if (db.pragma('integrity_check').some(row=>row.integrity_check!=='ok') || db.pragma('foreign_key_check').length) throw new Error('迁移后完整性检查失败；事务已回滚。');
    }).exclusive();
    console.log(JSON.stringify({mode:'apply',state:'migrated',backup,integrity:'ok',foreignKeyViolations:0}));
  } finally { db.close(); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
