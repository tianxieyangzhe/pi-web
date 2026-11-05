#!/usr/bin/env node
// Standalone offline migration. Preview is the default; no startup migration.
const fs = require('node:fs'),
  path = require('node:path'),
  Database = require('better-sqlite3');
const {
    createHash
  } = require('node:crypto'),
  {
    spawnSync
  } = require('node:child_process');
const root = path.resolve(__dirname, '..'),
  base = path.join(__dirname, 'historical-schema');
const schema = ['core-schema.sql', 'bot-schema.sql', 'role-schema.sql'].map(f => fs.readFileSync(path.join(base, f), 'utf8')).join('\n');
const changed = ['agents', 'sessions', 'bots', 'bot_conversations', 'bot_tasks', 'bot_task_dependencies', 'bot_executions', 'bot_messages'];
const reference = new Database(':memory:');
reference.exec(schema);
const target = reference.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all();
const quote = s => '"' + s.replaceAll('"', '""') + '"';
function rows(db, name) {
  return db.prepare('SELECT * FROM ' + quote(name)).all();
}
function snapshot(db) {
  return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(t => [t.name, rows(db, t.name)]));
}
function signature(db) {
  return target.filter(o => changed.includes(o.tbl_name)).every(o => db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(o.name)?.sql === o.sql);
}
function mapped(before) {
  const bindings = new Map((before.bot_conversation_sessions ?? []).map(b => [b.id, b]));
  const bySession = new Map((before.bot_conversation_sessions ?? []).map(b => [b.session_id, b]));
  if (bySession.size !== (before.bot_conversation_sessions ?? []).length) throw Error('重复会话归属，未迁移');
  const resolve = id => {
    if (id == null) return null;
    const b = bindings.get(id);
    if (!b) throw Error('绑定引用缺失 ' + id);
    return b.session_id;
  };
  const result = {};
  for (const table of changed) result[table] = (before[table] ?? []).map(old => {
    const row = {
      ...old
    };
    if (table === 'agents') Object.assign(row, {
      kind: null,
      bot_id: null,
      project_id: null,
      source_template_id: null,
      definition_json: null
    });
    if (table === 'sessions') {
      const b = bySession.get(row.id);
      Object.assign(row, {
        bot_conversation_id: b?.conversation_id ?? null,
        participant_name: b?.role_name || null,
        assignment: b?.responsibilities || null,
        collaboration_state: b?.status ?? null,
        bot_joined_at: b?.created_at ?? null,
        updated_at: b?.updated_at ?? row.last_activity_at ?? row.created_at
      });
    }
    if (table === 'bots') {
      row.legacy_instructions = row.instructions;
      delete row.instructions;
      Object.assign(row, {
        coordinator_agent_id: null,
        coordinator_agent_snapshot_json: null
      });
    }
    if (table === 'bot_conversations') {
      row.legacy_instructions_snapshot = row.instructions_snapshot;
      delete row.instructions_snapshot;
      Object.assign(row, {
        agent_id: null,
        agent_snapshot_json: null
      });
      if (row.work_state === 'active') row.work_state = 'paused';
    }
    if (table === 'bot_tasks') {
      row.target_session_id = resolve(row.target_binding_id);
      delete row.target_binding_id;
      const last = (before.bot_executions ?? []).filter(e => e.task_id === row.id).sort((a, b) => b.attempt_number - a.attempt_number)[0];
      row.waiting_for_message_id = row.state === 'waiting' ? JSON.parse(last?.result_json ?? '{}').waitingForMessageId ?? null : null;
      if (row.state === 'waiting' && !row.waiting_for_message_id) throw Error('等待任务缺少合法问题 ' + row.id);
    }
    if (table === 'bot_executions') {
      row.target_session_id = resolve(row.target_binding_id);
      delete row.target_binding_id;
      row.input = row.instruction_snapshot;
      delete row.instruction_snapshot;
      row.legacy_role_instructions_snapshot = row.role_instructions_snapshot;
      delete row.role_instructions_snapshot;
      row.agent_snapshot_json = null;
      row.assignment_snapshot = null;
    }
    if (table === 'bot_messages') {
      row.source_session_id = resolve(row.source_binding_id);
      row.target_session_id = resolve(row.target_binding_id);
      delete row.source_binding_id;
      delete row.target_binding_id;
      row.legacy_kind = row.kind;
      if (row.kind === 'instruction') row.kind = 'message';
    }
    return row;
  });
  return result;
}
function verify(db, before, expected) {
  for (const [table, original] of Object.entries(before)) {
    const want = changed.includes(table) ? expected[table] : original;
    const actual = rows(db, table);
    const stable = rs => rs.map(r => JSON.stringify(Object.fromEntries(Object.keys(r).sort().map(k => [k, r[k]])))).sort();
    if (JSON.stringify(stable(actual)) !== JSON.stringify(stable(want))) throw Error('历史覆盖核验失败 ' + table);
  }
  if (db.pragma('foreign_key_check').length) throw Error('外键核验失败');
  if (db.pragma('integrity_check', {
    simple: true
  }) !== 'ok') throw Error('数据库完整性失败');
  if (!signature(db)) throw Error('目标结构不完整');
}
async function migrate(file, apply = false) {
  let db = new Database(file, {
    readonly: true
  });
  if (signature(db)) {
    db.close();
    return {
      database: file,
      alreadyMigrated: true,
      message: '六表目标已完整存在，无需迁移'
    };
  }
  if (!db.prepare("SELECT name FROM sqlite_master WHERE name='bot_conversation_sessions'").get()) throw Error('需要完整七表旧结构，不能猜测迁移');
  const before = snapshot(db);
  for (const t of ['bot_executions', 'bot_messages']) if (before[t]?.some(r => ['starting', 'running', 'interrupting', 'delivering', 'unavailable'].includes(r.state))) throw Error('存在未核对执行/消息，先处理状态后离线迁移');
  const expected = mapped(before);
  db.close();
  const report = {
    database: file,
    mode: apply ? 'apply' : 'preview',
    runtimeTables: 6,
    historyBindingTable: 'bot_conversation_sessions（只读保留）',
    counts: Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v.length]))
  };
  if (!apply) return report;
  const occupancy = spawnSync('lsof', ['-t', '--', file], {
    encoding: 'utf8',timeout:10000
  });
  if (occupancy.error || occupancy.stdout.trim()) throw Error('数据库有打开连接或无法核对，未迁移');
  const listener = spawnSync('lsof', ['-t', '-iTCP:3000', '-sTCP:LISTEN'], {
    encoding: 'utf8',timeout:10000
  });
  if (listener.error || listener.stdout.trim()) throw Error('3000 服务仍在运行，未迁移');
  db = new Database(file);
  db.pragma('busy_timeout=5000');
  const backup = file + '.before-bot-v2-' + Date.now() + '.sqlite';
  await db.backup(backup);
  db.pragma('foreign_keys=OFF');
  try {
    db.transaction(() => {
      if (signature(db)) throw Error('目标结构在预检后发生变化');
      if (JSON.stringify(snapshot(db)) !== JSON.stringify(before)) throw Error('原数据发生变化，未迁移');
      const objects = db.prepare("SELECT type,name,tbl_name FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('index','trigger')").all();
      for (const o of objects) if (changed.includes(o.tbl_name) || o.tbl_name === 'bot_conversation_sessions') db.exec('DROP ' + o.type.toUpperCase() + ' ' + quote(o.name));
      for (const name of changed) db.exec('DROP TABLE ' + quote(name));
      for (const o of target.filter(o => o.type === 'table' && changed.includes(o.name))) db.exec(o.sql);
      for (const table of changed) {
        const cols = db.prepare('PRAGMA table_info(' + quote(table) + ')').all().map(c => c.name);
        for (const row of expected[table]) {
          const unknown = Object.keys(row).filter(k => !cols.includes(k));
          if (unknown.length) throw Error('未映射字段 ' + table + ':' + unknown.join(','));
          const keys = Object.keys(row);
          db.prepare('INSERT INTO ' + quote(table) + ' (' + keys.map(quote).join(',') + ') VALUES(' + keys.map(() => '?').join(',') + ')').run(...keys.map(k => row[k]));
        }
      }
      for (const o of target.filter(o => o.type !== 'table' && changed.includes(o.tbl_name))) db.exec(o.sql);
      for (const action of ['INSERT', 'UPDATE', 'DELETE']) db.exec('CREATE TRIGGER history_binding_' + action.toLowerCase() + " BEFORE " + action + " ON bot_conversation_sessions BEGIN SELECT RAISE(ABORT,'legacy binding is read-only'); END;");
      verify(db, before, expected);
    })();
    db.pragma('foreign_keys=ON');
    return {
      ...report,
      migrated: true,
      backup,
      preserved: true
    };
  } finally {
    db.close();
  }
}
if (require.main === module) {
  const file = path.resolve(process.argv[2] ?? path.join(root, '.data/ai-workspace-v5.sqlite'));
  migrate(file, process.argv.includes('--apply')).then(r => console.log(JSON.stringify(r, null, 2))).catch(e => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
module.exports = {
  migrate,
  mapped,
  signature,
  schema
};
