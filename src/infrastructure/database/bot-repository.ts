import { hydrateAgentSnapshot, serializeAgentSnapshot } from "./agent-snapshot.server";
import { readAgentVersion } from "../agents/agent-file-store.server";
import Database from "better-sqlite3";
import type { BotTables, BotDependency, BotConversationStats, BotProjectAgentBinding, BotProjectBinding, ProjectCall, ProjectCallStatus } from "@/domain/bot";
import { DomainError } from "@/domain/errors";
import type { BotRepositoryPort } from "@/application/ports/bot";
import { targetSchema } from "./schema.server";
import type { AgentSnapshot } from "@/domain/models";

const reference = new Database(":memory:");
reference.exec(targetSchema);
const expected = reference.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name='project_calls' OR name LIKE 'bot_%' OR name='bots' OR tbl_name IN ('agents','sessions') ORDER BY name").all();
reference.close();
const tables = ["bots", "bot_conversations", "project_calls"] as const;
const jsonFields = new Set(["nativeRef", "coordinatorAgentSnapshot"]);
const snake = (value: string) => value === "coordinatorAgentSnapshot" ? "coordinator_agent_snapshot_json" : value.replace(/[A-Z]/g, letter => "_" + letter.toLowerCase());

function map<T>(row: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const normalized = key === "coordinator_agent_snapshot_json" ? "coordinator_agent_snapshot" : key;
    const field = normalized.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    result[field] = jsonFields.has(field) && value !== null ? JSON.parse(String(value)) : value;
  }
  if (result.coordinatorAgentSnapshot) result.coordinatorAgentSnapshot = hydrateAgentSnapshot(result.coordinatorAgentSnapshot);
  return result as T;
}
function encode(key: string, value: unknown) {
  if (key === "coordinatorAgentSnapshot" && value !== null) return JSON.stringify(serializeAgentSnapshot(value as AgentSnapshot));
  return jsonFields.has(key) && value !== null ? JSON.stringify(value) : value;
}

export function createBotRepository(db: Database.Database): BotRepositoryPort {
  const has = () => {
    const actual = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name='project_calls' OR name LIKE 'bot_%' OR name='bots' OR tbl_name IN ('agents','sessions') ORDER BY name").all();
    return JSON.stringify(actual) === JSON.stringify(expected) && !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('bot_works','bot_tasks','bot_executions','bot_messages')").get();
  };
  const assert = () => { if (!has()) throw new DomainError("SCHEMA_INCOMPATIBLE", "数据库不是当前协调会话模型，已阻止写入。", 409, true); };
  return {
    available: has,
    assertAvailable: assert,
    transaction: fn => { assert(); return db.transaction(fn)(); },
    get(table, id) {
      assert();
      if (!tables.includes(table)) throw new DomainError("NOT_FOUND", "记录不存在", 404, true);
      const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as Record<string, unknown> | undefined;
      return row ? map(row) : null;
    },
    list(table, filter = {}, limit = 2147483647) {
      assert();
      if (!tables.includes(table)) return [];
      const pairs = Object.entries(filter);
      const where = pairs.map(([key, value]) => `${snake(key)} ${value === null ? "IS NULL" : "=?"}`).join(" AND ");
      return (db.prepare(`SELECT * FROM ${table}${where ? " WHERE " + where : ""} ORDER BY created_at,id LIMIT ?`).all(...pairs.filter(([, value]) => value !== null).map(([key, value]) => encode(key, value)), limit) as Record<string, unknown>[]).map(row => map(row));
    },
    page(table, filter, before, limit = 50) {
      assert();
      const count = Math.max(1, Math.min(100, limit));
      const pairs = Object.entries(filter);
      const clauses = pairs.map(([key, value]) => `${snake(key)} ${value === null ? "IS NULL" : "=?"}`);
      const args = pairs.filter(([, value]) => value !== null).map(([key, value]) => encode(key, value));
      if (before) {
        const values = JSON.parse(Buffer.from(before, "base64url").toString("utf8")) as unknown;
        if (!Array.isArray(values) || values.length !== 2 || values.some(value => typeof value !== "string")) throw new DomainError("INVALID_BOT_INPUT", "历史游标无效", 422, true);
        clauses.push("(created_at<? OR (created_at=? AND id<?))");
        args.push(values[0], values[0], values[1]);
      }
      const rows = db.prepare(`SELECT * FROM ${table}${clauses.length ? " WHERE " + clauses.join(" AND ") : ""} ORDER BY created_at DESC,id DESC LIMIT ?`).all(...args, count + 1) as Record<string, unknown>[];
      const items = rows.slice(0, count);
      const last = items.at(-1);
      return { items: items.reverse().map(row => map(row)), nextCursor: rows.length > count && last ? Buffer.from(JSON.stringify([last.created_at, last.id])).toString("base64url") : null };
    },
    insert(table, value) {
      assert();
      const entries = Object.entries(value);
      db.prepare(`INSERT INTO ${table} (${entries.map(([key]) => snake(key)).join(",")}) VALUES(${entries.map(() => "?").join(",")})`).run(...entries.map(([key, item]) => encode(key, item)));
      return value;
    },
    update(table, id, patch, expectedState) {
      assert();
      const current = this.get(table, id);
      if (!current) throw new DomainError("NOT_FOUND", "Bot 记录不存在", 404, true);
      const entries = Object.entries({ ...patch, updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString() });
      const result = db.prepare(`UPDATE ${table} SET ${entries.map(([key]) => snake(key) + "=?").join(",")} WHERE id=?${expectedState ? " AND status=?" : ""}`).run(...entries.map(([key, item]) => encode(key, item)), id, ...(expectedState ? [expectedState] : []));
      if (!result.changes) throw new DomainError("BOT_CONFLICT", "记录已更新，请刷新", 409, true);
      return this.get(table, id)!;
    },
    dependencies: () => [],
    addDependency() { throw new DomainError("NOT_FOUND", "当前模型没有任务依赖", 404, true); },
    participants(conversationId) {
      assert();
      return (db.prepare("SELECT * FROM sessions WHERE bot_conversation_id=? ORDER BY bot_joined_at,id").all(conversationId) as Record<string, unknown>[]).map(row => ({
        id: String(row.id), botConversationId: String(row.bot_conversation_id), participantName: row.participant_name as string | null,
        assignment: row.assignment as string | null, collaborationState: row.collaboration_state as "active" | "disabled", botJoinedAt: String(row.bot_joined_at), updatedAt: String(row.updated_at),
      }));
    },
    parentForSession(sessionId) {
      if (!has()) return null;
      return (db.prepare("SELECT bot_conversation_id FROM sessions WHERE id=?").get(sessionId) as { bot_conversation_id: string | null } | undefined)?.bot_conversation_id ?? null;
    },
    updateParticipant(sessionId, patch) {
      assert();
      const pairs = Object.entries(patch);
      db.prepare("UPDATE sessions SET " + pairs.map(([key]) => snake(key) + "=?").join(",") + ",updated_at=? WHERE id=?").run(...pairs.map(([, value]) => value), new Date().toISOString(), sessionId);
    },
    setSessionRole(sessionId, agentId, agentSnapshot) {
      assert();
      db.prepare("UPDATE sessions SET agent_id=?,agent_snapshot_json=?,updated_at=? WHERE id=?").run(agentId, JSON.stringify(serializeAgentSnapshot(agentSnapshot)), new Date().toISOString(), sessionId);
    },
    replaceBotConfiguration(botId, projectIds, bindings, addedAt) {
      assert();
      const selected = new Set(projectIds);
      if (selected.size !== projectIds.length || bindings.some(item => !selected.has(item.projectId))) throw new DomainError("INVALID_BOT_INPUT", "Agent 绑定的项目必须位于 Bot 项目范围内", 422, true);
      db.prepare("DELETE FROM bot_project_agents WHERE bot_id=?").run(botId);
      db.prepare("DELETE FROM bot_projects WHERE bot_id=?").run(botId);
      const addProject = db.prepare("INSERT INTO bot_projects(bot_id,project_id,added_at) VALUES(?,?,?)");
      for (const projectId of projectIds) addProject.run(botId, projectId, addedAt);
      const addAgent = db.prepare("INSERT INTO bot_project_agents(bot_id,project_id,agent_id,agent_revision,content_sha256,added_at) VALUES(?,?,?,?,?,?)");
      for (const item of bindings) addAgent.run(botId, item.projectId, item.agentId, item.agentRevision, item.contentSha256, addedAt);
    },
    botConfiguration(botId) { return configuration(db, "bot_projects", "bot_project_agents", "bot_id", botId); },
    snapshotBotConfiguration(botId, conversationId, addedAt) {
      assert();
      const projects = db.prepare("SELECT project_id FROM bot_projects WHERE bot_id=? ORDER BY project_id").all(botId) as Array<{ project_id: string }>;
      const addProject = db.prepare("INSERT INTO bot_conversation_projects(bot_conversation_id,project_id,added_at) VALUES(?,?,?)");
      const addAgent = db.prepare("INSERT INTO bot_conversation_project_agents(bot_conversation_id,project_id,agent_id,agent_revision,content_sha256,added_at) VALUES(?,?,?,?,?,?)");
      for (const { project_id: projectId } of projects) {
        addProject.run(conversationId, projectId, addedAt);
        const bindings = db.prepare("SELECT agent_id,agent_revision,content_sha256 FROM bot_project_agents WHERE bot_id=? AND project_id=? ORDER BY agent_id").all(botId, projectId) as Array<{ agent_id: string; agent_revision: number; content_sha256: string }>;
        for (const item of bindings) addAgent.run(conversationId, projectId, item.agent_id, item.agent_revision, item.content_sha256, addedAt);
      }
    },
    conversationConfiguration(conversationId) { return configuration(db, "bot_conversation_projects", "bot_conversation_project_agents", "bot_conversation_id", conversationId); },
    adoptConversationProjectAgent(conversationId, projectId, agentId, revision, sha256) {
      assert();
      const result = db.prepare("UPDATE bot_conversation_project_agents SET agent_revision=?,content_sha256=? WHERE bot_conversation_id=? AND project_id=? AND agent_id=?").run(revision, sha256, conversationId, projectId, agentId);
      if (!result.changes) throw new DomainError("ROLE_BINDING_INVALID", "项目 Agent 不在当前协调会话范围内", 409, true);
    },
    conversationStats(conversationId): BotConversationStats {
      assert();
      const count = (sql: string) => Number((db.prepare(sql).get(conversationId) as { count: number }).count);
      const calls = db.prepare("SELECT status,count(*) AS count FROM project_calls WHERE conversation_id=? GROUP BY status").all(conversationId) as Array<{ status: string; count: number }>;
      return {
        projectCount: count("SELECT count(*) AS count FROM bot_conversation_projects WHERE bot_conversation_id=?"),
        projectAgentCandidateCount: count("SELECT count(*) AS count FROM bot_conversation_project_agents WHERE bot_conversation_id=?"),
        projectSessionCount: count("SELECT count(*) AS count FROM sessions WHERE bot_conversation_id=?"),
        callCount: calls.reduce((total, row) => total + Number(row.count), 0),
        activeCallCount: calls.filter(row => row.status === "accepted" || row.status === "working").reduce((total, row) => total + Number(row.count), 0),
        unknownCallCount: Number(calls.find(row => row.status === "unknown")?.count ?? 0),
      };
    },
    isProjectAgentBound: (conversationId, projectId, agentId) => !!db.prepare("SELECT 1 FROM bot_conversation_project_agents WHERE bot_conversation_id=? AND project_id=? AND agent_id=?").get(conversationId, projectId, agentId),
    deleteConversation(conversationId) {
      assert();
      const sessions = db.prepare("SELECT id,session_memory_id FROM sessions WHERE bot_conversation_id=?").all(conversationId) as Array<{ id: string; session_memory_id: string }>;
      db.prepare("DELETE FROM project_calls WHERE conversation_id=?").run(conversationId);
      db.prepare("DELETE FROM bot_conversation_project_agents WHERE bot_conversation_id=?").run(conversationId);
      db.prepare("DELETE FROM bot_conversation_projects WHERE bot_conversation_id=?").run(conversationId);
      for (const session of sessions) db.prepare("DELETE FROM sessions WHERE id=? AND bot_conversation_id=?").run(session.id, conversationId);
      for (const session of sessions) db.prepare("DELETE FROM session_memories WHERE id=? AND NOT EXISTS(SELECT 1 FROM sessions WHERE session_memory_id=?)").run(session.session_memory_id, session.session_memory_id);
      if (!db.prepare("DELETE FROM bot_conversations WHERE id=?").run(conversationId).changes) throw new DomainError("NOT_FOUND", "协调会话不存在", 404, true);
    },
    findProjectCall(conversationId, projectId, sourceEntryId, sentContent) {
      assert();
      const row = db.prepare("SELECT * FROM project_calls WHERE conversation_id=? AND project_id=? AND source_entry_id=? AND sent_content=?").get(conversationId, projectId, sourceEntryId, sentContent) as Record<string, unknown> | undefined;
      return row ? map<ProjectCall>(row) : null;
    },
    projectCalls: conversationId => (db.prepare("SELECT * FROM project_calls WHERE conversation_id=? ORDER BY created_at,id").all(conversationId) as Record<string, unknown>[]).map(row => map<ProjectCall>(row)),
    updateProjectCall(id, expected, patch) {
      assert();
      const current = db.prepare("SELECT * FROM project_calls WHERE id=? AND status=?").get(id, expected) as Record<string, unknown> | undefined;
      if (!current) throw new DomainError("BOT_CONFLICT", "项目调用状态已变化", 409, true);
      const next = { ...map<ProjectCall>(current), ...patch, updatedAt: new Date().toISOString() };
      db.prepare("UPDATE project_calls SET session_id=?,status=?,start_entry_id=?,end_entry_id=?,updated_at=? WHERE id=? AND status=?").run(next.sessionId, next.status, next.startEntryId, next.endEntryId, next.updatedAt, id, expected);
      return next;
    },
    recover(runtimeInstanceId, liveSessionIds = new Set()) {
      if (!has()) return;
      const calls = db.prepare("SELECT id,session_id,status FROM project_calls WHERE status IN ('accepted','working')").all() as Array<{ id: string; session_id: string | null; status: ProjectCallStatus }>;
      db.transaction(() => {
        for (const call of calls) {
          if (call.session_id && liveSessionIds.has(call.session_id)) continue;
          db.prepare("UPDATE project_calls SET status='unknown',updated_at=? WHERE id=? AND status=?").run(new Date().toISOString(), call.id, call.status);
        }
      })();
      void runtimeInstanceId;
    },
  };
}

function configuration(db: Database.Database, projectTable: string, agentTable: string, ownerColumn: string, ownerId: string): BotProjectBinding[] {
  const projects = db.prepare(`SELECT project_id FROM ${projectTable} WHERE ${ownerColumn}=? ORDER BY project_id`).all(ownerId) as Array<{ project_id: string }>;
  return projects.map(({ project_id: projectId }) => {
    const rows = db.prepare(`SELECT agent_id,agent_revision,content_sha256 FROM ${agentTable} WHERE ${ownerColumn}=? AND project_id=? ORDER BY agent_id`).all(ownerId, projectId) as Array<{ agent_id: string; agent_revision: number; content_sha256: string }>;
    return { projectId, agents: rows.map(row => {
      const value = readAgentVersion(row.agent_id, row.agent_revision, row.content_sha256);
      return { agentId: value.agentId, revision: value.revision, kind: value.kind, botId: null, projectId: null, contentSha256: value.contentSha256, name: value.name, description: value.description };
    }) };
  });
}

export type { BotProjectAgentBinding };
