#!/usr/bin/env node
'use strict';
// Explicit additive migration. Never imported by application startup.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { inspect } = require('./image-schema-preflight.cjs');
const query = "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name";
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? { integer: String(item) } : item);
const quote = name => '"' + name.replaceAll('"', '""') + '"';
function assertPath(filename) {
  for (let current = filename;; current = path.dirname(current)) {
    if (fs.lstatSync(current).isSymbolicLink()) throw Error('Symlink rejected: ' + current);
    if (current === path.dirname(current)) break;
  }
  if (!fs.statSync(filename).isFile()) throw Error('Database must be an existing regular file');
}
function snapshot(db, tables) {
  const schema = db.prepare(query).all().filter(row => !tables || tables.includes(row.name) || !row.name.startsWith('image_'));
  const names = tables || schema.filter(row => row.type === 'table').map(row => row.name);
  const rows = Object.fromEntries(names.map(name => {
    const values = db.prepare('SELECT * FROM ' + quote(name)).safeIntegers().raw().all().map(json).sort();
    return [name, { count: values.length, sha256: digest(json(values)) }];
  }));
  return { schemaSha256: digest(json(schema)), rows, sha256: digest(json({ schema, rows })) };
}
function healthy(db) {
  if (db.pragma('integrity_check', { simple: true }) !== 'ok' || db.pragma('foreign_key_check').length) throw Error('Integrity or foreign key check failed');
}
function noConnections(filename) {
  const files = [filename, filename + '-wal', filename + '-shm'].filter(file => fs.existsSync(file));
  const result = spawnSync('lsof', ['-F', 'p', '--', ...files], { encoding: 'utf8' });
  if (result.error || ![0, 1].includes(result.status) || result.stderr.trim()) throw Error('Cannot verify database connections: ' + (result.error?.message || result.stderr));
  const pids = [...new Set(result.stdout.split('\n').filter(line => /^p\d+$/.test(line)).map(line => Number(line.slice(1))))].filter(pid => pid !== process.pid);
  if (pids.length) throw Error('Database is open in process(es): ' + pids.join(', ') + '. Release connections before migration; no service was stopped.');
}
function schemas() {
  const root = path.resolve(__dirname, '..');
  const dir = fs.existsSync(path.join(root, 'runtime/database')) ? path.join(root, 'runtime/database') : path.join(root, 'src/infrastructure/database');
  const files = ['core-schema.sql', 'role-schema.sql', 'workspace-schema.sql', 'image-schema.sql'];
  return files.map(name => fs.readFileSync(path.join(dir, name), 'utf8'));
}
function plan(filename) {
  filename = path.resolve(filename);
  assertPath(filename);
  const inspection = inspect(filename);
  if (!['requires_explicit_image_upgrade', 'current'].includes(inspection.status)) throw Error('Unknown or partial schema; migration refused');
  const db = new Database(filename, { readonly: true, fileMustExist: true });
  let source;
  try { db.pragma('query_only=ON'); healthy(db); source = snapshot(db); } finally { db.close(); }
  const ddl = schemas();
  const details = { version: 1, filename, status: inspection.status, source, targetDdlSha256: digest(ddl.join('\n')), imageDdlSha256: digest(ddl[3]), targetTables: inspection.targetTables, addedTables: inspection.addedTables };
  return { ...details, planSha256: digest(json(details)), migrationExecuted: false };
}
function flush(filename) {
  const fd = fs.openSync(filename, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function writeManifest(directory, value, name = 'manifest.json') {
  const file = path.join(directory, name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o400, flag: 'wx' });
  flush(file); flush(directory);
}
async function execute(filename, planSha256) {
  filename = path.resolve(filename);
  assertPath(filename);
  noConnections(filename);
  const initial = plan(filename);
  if (initial.planSha256 !== planSha256) throw Error('Plan is stale; run read-only inspection again');
  if (initial.status === 'current') return initial;
  const lock = filename + '.image-upgrade.lock';
  fs.mkdirSync(lock, { mode: 0o700 });
  let source, db, directory, backupSha256;
  try {
    noConnections(filename);
    source = new Database(filename, { readonly: true, fileMustExist: true });
    healthy(source);
    if (snapshot(source).sha256 !== initial.source.sha256) throw Error('Source changed before backup');
    directory = filename + '.image-upgrade-' + crypto.randomUUID();
    fs.mkdirSync(directory, { mode: 0o700 });
    const backupFile = path.join(directory, 'before.sqlite');
    await source.backup(backupFile);
    source.close(); source = null;
    const backup = new Database(backupFile, { fileMustExist: true });
    try {
      backup.pragma('journal_mode=DELETE');
      healthy(backup);
      if (snapshot(backup).sha256 !== initial.source.sha256) throw Error('Backup does not match inspected source');
    } finally { backup.close(); }
    flush(backupFile); fs.chmodSync(backupFile, 0o400); flush(backupFile);
    backupSha256 = digest(fs.readFileSync(backupFile));
    writeManifest(directory, { ...initial, backupSha256, backedUpAt: new Date().toISOString() });
    flush(path.dirname(directory));
    noConnections(filename);
    const ddl = schemas();
    if (digest(ddl.join('\n')) !== initial.targetDdlSha256) throw Error('Target DDL changed');
    db = new Database(filename, { fileMustExist: true, timeout: 0 });
    db.pragma('foreign_keys=ON');
    db.exec('BEGIN EXCLUSIVE');
    noConnections(filename);
    healthy(db);
    if (snapshot(db).sha256 !== initial.source.sha256) throw Error('Source changed after inspection');
    db.exec(ddl[3]);
    const expected = new Database(':memory:');
    try {
      expected.exec(ddl.join('\n'));
      const normalize = rows => rows.map(row => ({ ...row, sql: (row.sql || '').replace(/^CREATE TABLE "([A-Za-z_][A-Za-z0-9_]*)"/, 'CREATE TABLE $1').replace(/\s+/g, ' ').trim() }));
      if (json(normalize(db.prepare(query).all())) !== json(normalize(expected.prepare(query).all()))) throw Error('Target schema mismatch');
    } finally { expected.close(); }
    const preserved = snapshot(db, Object.keys(initial.source.rows));
    if (preserved.sha256 !== initial.source.sha256) throw Error('Original tables or rows changed');
    healthy(db);
    noConnections(filename);
    db.exec('COMMIT');
    db.close(); db = null;
    const result = { status: 'migrated', filename, planSha256, backupDirectory: directory, backupSha256, preservedRowCounts: Object.fromEntries(Object.entries(initial.source.rows).map(([name, value]) => [name, value.count])), targetTables: initial.targetTables, integrityCheck: 'ok', foreignKeyErrors: 0, migrationExecuted: true };
    writeManifest(directory, { ...result, completedAt: new Date().toISOString() }, 'result.json');
    return result;
  } catch (error) {
    if (db?.inTransaction) db.exec('ROLLBACK');
    if (directory) error.message += ' Backup/evidence retained at ' + directory;
    throw error;
  } finally {
    source?.close(); db?.close(); fs.rmdirSync(lock);
  }
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const filename = args[0] || path.resolve('.data/ai-workspace-v5.sqlite');
  const valid = !filename.startsWith('--') && (args.length <= 1 || (args.length === 4 && args[1] === '--execute' && args[2] === '--plan-sha256' && /^[a-f0-9]{64}$/.test(args[3])));
  if (!valid) { console.error('Usage: node scripts/upgrade-image-schema.cjs [database-file] [--execute --plan-sha256 HASH]'); process.exitCode = 1; }
  else Promise.resolve().then(() => args.length === 4 ? execute(filename, args[3]) : plan(filename)).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { plan, execute };
