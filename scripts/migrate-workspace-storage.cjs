#!/usr/bin/env node
// Explicit offline upgrade. No app bootstrap or Pi history access.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const schemaDirectory = path.join(__dirname, 'historical-schema');
const core = fs.readFileSync(path.join(schemaDirectory, 'core-schema.sql'), 'utf8');
const workspace = fs.readFileSync(path.join(schemaDirectory, 'workspace-schema.sql'), 'utf8');
const memoryTable = core.match(/CREATE TABLE session_memories \([\s\S]*?\n  \);/)[0];
const ownerTriggers = core.split('\n').filter(line => /^\s*CREATE TRIGGER (session_memories_owner_immutable|memory_template_insert|memory_template_update)\b/.test(line));
const ownerNames = ['session_memories_owner_immutable', 'memory_template_insert', 'memory_template_update'];
const oldColumns = ['id', 'project_id', 'source_template_id', 'title', 'context_json', 'draft_json', 'last_reviewed_entry_id', 'created_at', 'updated_at'];
const workspaceNames = ['workspaces', 'workspace_projects', 'workspace_sessions'];
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const normalize = sql => sql.trim().replace(/;$/, '').replaceAll('"', '').replace(/\s+/g, ' ');
const oldMemoryTable = memoryTable.replace(/^.*workspace_id.*\n/gm, '');
// The line containing the template CHECK also includes workspace_id, so restore it explicitly.
const legacyMemoryTable = oldMemoryTable.replace(/UNIQUE\(id, project_id\),\s*\);/, "UNIQUE(id, project_id),\n    CHECK(project_id IS NOT NULL OR (source_template_id IS NULL AND draft_json IS NULL AND last_reviewed_entry_id IS NULL))\n  );");
function schema(db) {
  return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
}
function healthy(db) {
  if (db.pragma('integrity_check').some(row => row.integrity_check !== 'ok')) throw new Error('数据库完整性检查失败');
  if (db.pragma('foreign_key_check').length) throw new Error('数据库存在外键错误');
}
function checkOffline(file) {
  for (const candidate of [file, file + '-wal', file + '-shm']) {
    if (!fs.existsSync(candidate)) continue;
    const result = spawnSync('lsof', ['-t', candidate], { encoding: 'utf8' });
    if (result.error || ![0, 1].includes(result.status)) throw new Error('无法核对数据库打开连接');
    if (result.stdout.trim()) throw new Error(`数据库仍有打开连接（PID ${result.stdout.trim().replace(/\s+/g, ', ')}）；未修改数据库。`);
  }
}
function validate(db) {
  healthy(db);
  const objects = schema(db);
  const memory = objects.find(item => item.type === 'table' && item.name === 'session_memories');
  if (!memory) throw new Error('缺少 session_memories；拒绝升级未知结构');
  const hasOwner = db.prepare('PRAGMA table_info(session_memories)').all().some(column => column.name === 'workspace_id');
  const found = workspaceNames.filter(name => objects.some(item => item.type === 'table' && item.name === name));
  if (hasOwner || found.length) {
    if (!hasOwner || found.length !== workspaceNames.length || normalize(memory.sql) !== normalize(memoryTable)) throw new Error('工作区结构不完整或与目标不符');
    // Compare every canonical workspace object, including constraints and triggers.
    const reference = new Database(':memory:');
    try {
      reference.exec(core + workspace);
      const expected = schema(reference).filter(item => workspaceNames.includes(item.tbl_name) || ownerNames.includes(item.name) || item.name === 'session_memories_project_idx');
      for (const item of expected) {
        const actual = objects.find(candidate => candidate.type === item.type && candidate.name === item.name);
        if (!actual || normalize(actual.sql) !== normalize(item.sql)) throw new Error('目标对象不匹配：' + item.name);
      }
    } finally { reference.close(); }
    return 'already-migrated';
  }
  if (normalize(memory.sql) !== normalize(legacyMemoryTable)) throw new Error('旧记忆表与已支持基线不符；拒绝升级未知结构');
  for (const name of ['projects', 'agents', 'sessions', 'bots', 'bot_conversations', 'project_calls']) {
    if (!objects.some(item => item.type === 'table' && item.name === name)) throw new Error('旧库缺少必要表：' + name);
  }
  const columns = db.prepare('PRAGMA table_info(session_memories)').all().map(column => column.name);
  if (JSON.stringify(columns) !== JSON.stringify(oldColumns)) throw new Error('旧记忆列与基线不符');
  for (const name of ownerNames) {
    if (!objects.some(item => item.type === 'trigger' && item.name === name && item.tbl_name === 'session_memories')) throw new Error('缺少旧记忆触发器：' + name);
  }
  if (objects.some(item => item.name === 'session_memories_workspace_upgrade')) throw new Error('发现迁移暂存表');
  return 'legacy';
}
function snapshot(db) {
  return schema(db).filter(item => item.type === 'table').map(item => {
    const columns = db.prepare(`PRAGMA table_info(${quote(item.name)})`).all().map(column => column.name);
    const rows = db.prepare(`SELECT ${columns.map(quote).join(',')} FROM ${quote(item.name)}`).raw().all();
    const values = rows.map(row => JSON.stringify(row, (_key, value) => typeof value === 'bigint' ? String(value) : value)).sort();
    return { name: item.name, columns, count: rows.length, digest: createHash('sha256').update(JSON.stringify(values)).digest('hex') };
  });
}
function verifyPreserved(db, before) {
  for (const table of before) {
    const rows = db.prepare(`SELECT ${table.columns.map(quote).join(',')} FROM ${quote(table.name)}`).raw().all();
    const values = rows.map(row => JSON.stringify(row, (_key, value) => typeof value === 'bigint' ? String(value) : value)).sort();
    const digest = createHash('sha256').update(JSON.stringify(values)).digest('hex');
    if (rows.length !== table.count || digest !== table.digest) throw new Error('历史记录不一致：' + table.name);
  }
}
function migrate(db) {
  if (validate(db) !== 'legacy') return;
  const before = snapshot(db), objects = schema(db);
  const custom = objects.filter(item => item.tbl_name === 'session_memories' && ['index', 'trigger'].includes(item.type) && !ownerNames.includes(item.name));
  const untouched = objects.filter(item => item.tbl_name !== 'session_memories');
  db.exec(memoryTable.replace('CREATE TABLE session_memories (', 'CREATE TABLE session_memories_workspace_upgrade ('));
  const columns = oldColumns.map(quote).join(',');
  db.exec(`INSERT INTO session_memories_workspace_upgrade (${columns},workspace_id) SELECT ${columns},NULL FROM session_memories`);
  db.exec('DROP TABLE session_memories');
  db.exec('ALTER TABLE session_memories_workspace_upgrade RENAME TO session_memories');
  for (const item of custom) db.exec(item.sql);
  for (const trigger of ownerTriggers) db.exec(trigger);
  db.exec(workspace);
  verifyPreserved(db, before);
  if (db.prepare('SELECT count(*) n FROM session_memories WHERE workspace_id IS NOT NULL').get().n) throw new Error('旧记忆不得自动归属工作区');
  const after = schema(db);
  for (const item of untouched) {
    const actual = after.find(row => row.name === item.name && row.type === item.type);
    if (!actual || actual.sql !== item.sql) throw new Error('非迁移对象发生变化：' + item.name);
  }
  if (validate(db) !== 'already-migrated') throw new Error('目标结构校验失败');
}
async function upgrade(file, { apply = false } = {}) {
  file = path.resolve(file);
  if (apply) checkOffline(file);
  const db = new Database(file, { readonly: !apply, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 1000');
    db.pragma('foreign_keys = ON');
    const state = validate(db);
    const before = snapshot(db);
    if (!apply || state === 'already-migrated') return { mode: apply ? 'apply' : 'preview', state, tables: before.map(({ name, count }) => ({ name, count })) };
    const backup = file + '.pre-workspace-' + new Date().toISOString().replace(/[:.]/g, '-') + '.bak';
    await db.backup(backup);
    fs.chmodSync(backup, 0o600);
    const backupDb = new Database(backup, { readonly: true, fileMustExist: true });
    try { healthy(backupDb); verifyPreserved(backupDb, before); } finally { backupDb.close(); }
    db.pragma('foreign_keys = OFF');
    db.pragma('legacy_alter_table = ON');
    try { db.transaction(() => migrate(db)).exclusive(); }
    finally { db.pragma('legacy_alter_table = OFF'); db.pragma('foreign_keys = ON'); }
    healthy(db);
    verifyPreserved(db, before);
    return { mode: 'apply', state: 'migrated', backup, integrity: 'ok', foreignKeyViolations: 0, preserved: before.map(({ name, count }) => ({ name, count })) };
  } finally { db.close(); }
}
module.exports = { upgrade };
if (require.main === module) {
  const args = process.argv.slice(2);
  const invalid = args.filter(arg => arg.startsWith('--') && arg !== '--apply');
  if (invalid.length || args.filter(arg => !arg.startsWith('--')).length > 1) { console.error('用法：node scripts/migrate-workspace-storage.cjs [数据库路径] [--apply]'); process.exitCode = 1; }
  else upgrade(args.find(arg => !arg.startsWith('--')) || '.data/ai-workspace-v5.sqlite', { apply: args.includes('--apply') })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
