import { deleteSessionRecord } from "./delete-session.server";
import type Database from "better-sqlite3";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DomainError } from "@/domain/errors";
import { emptyContext, validateContext } from "@/domain/session-memory";
import { digest, workspaceETag, type WorkspaceRecord, type WorkspaceSession, type WorkspaceMemory } from "@/domain/workspace";
import type { WorkspaceRepository } from "@/application/ports/workspace";

type Row = Record<string, unknown>;
const notFound = () => new DomainError("NOT_FOUND", "工作区或会话不存在", 404, true);
export function createWorkspaceRepository(db: Database.Database): WorkspaceRepository {
  const available = () => {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name:string}>;
    return ['workspaces','workspace_projects','workspace_sessions'].every(name => names.some(row => row.name === name)) && (db.prepare('PRAGMA table_info(session_memories)').all() as Array<{name:string}>).some(column => column.name === 'workspace_id');
  };
  function assert() { if (!available()) throw new DomainError('SCHEMA_INCOMPATIBLE', '工作区需要新增存储结构；现有数据未修改，请单独确认数据库升级。', 409, true); }
  function session(row: Row): WorkspaceSession { return { id: String(row.id), workspaceId: String(row.workspace_id), defaultProjectId: String(row.default_project_id), sessionMemoryId: String(row.session_memory_id), purpose: String(row.purpose), nativeRef: row.native_ref_json ? JSON.parse(String(row.native_ref_json)) : null, createdAt: String(row.created_at), endedAt: row.ended_at as string | null }; }
  const repository: WorkspaceRepository = {
    available,
    list() { assert(); return (db.prepare('SELECT id FROM workspaces ORDER BY created_at,id').all() as Array<{id:string}>).map(row => this.get(row.id)!); },
    get(id) {
      assert(); const row = db.prepare('SELECT * FROM workspaces WHERE id=?').get(id) as Row | undefined; if (!row) return null;
      const projects = (db.prepare('SELECT * FROM workspace_projects WHERE workspace_id=? ORDER BY ordinal,id').all(id) as Row[]).map(p => ({ id: String(p.id), workspaceId: id, rootPath: String(p.root_path), name: path.basename(String(p.root_path)) || path.parse(String(p.root_path)).root }));
      const result = { id, name: String(row.name), defaultProjectId: String(row.default_project_id), projects, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
      return { ...result, writeETag: workspaceETag(result) };
    },
    save(id, input, credential) {
      assert(); return db.transaction(() => {
        const hash = digest(input);
        if (!id) {
          const existing = db.prepare('SELECT id,create_request_sha256 FROM workspaces WHERE create_request_key=?').get(credential) as Row | undefined;
          if (existing) { if (existing.create_request_sha256 !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT','创建键已用于其他内容',409,true); return this.get(String(existing.id))!; }
        }
        const current = id ? this.get(id) : null;
        if (id && !current) throw notFound();
        if (current && current.writeETag !== credential) throw new DomainError('WRITE_CONFLICT','工作区已更新，请重新读取',409,true);
        const workspaceId = id ?? randomUUID();
        const projects = input.projects.map((p, ordinal) => {
          if (p.id && !current?.projects.some(existing => existing.id === p.id)) throw notFound();
          return { ...p, id: p.id ?? randomUUID(), ordinal };
        });
        const nextIds = new Set(projects.map(p => p.id));
        for (const old of current?.projects ?? []) {
          const used = db.prepare('SELECT 1 FROM workspace_sessions WHERE default_project_id=? LIMIT 1').get(old.id);
          if (used && (!nextIds.has(old.id) || projects.find(p => p.id === old.id)?.rootPath !== old.rootPath)) throw new DomainError('START_PROJECT_UNAVAILABLE','已有会话使用此默认目录，不能移除或修改',409,true);
        }
        const timestamp = new Date(Math.max(Date.now(), current ? Date.parse(current.updatedAt) + 1 : 0)).toISOString();
        if (!current) db.prepare('INSERT INTO workspaces VALUES(?,?,?,?,?,?,?)').run(workspaceId,input.name,projects[input.defaultProjectIndex].id,credential,hash,timestamp,timestamp);
        for (const p of projects) db.prepare('INSERT INTO workspace_projects(id,workspace_id,root_path,ordinal) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET root_path=excluded.root_path,ordinal=excluded.ordinal').run(p.id,workspaceId,p.rootPath,p.ordinal);
        db.prepare('UPDATE workspaces SET name=?,default_project_id=?,updated_at=? WHERE id=?').run(input.name,projects[input.defaultProjectIndex].id,timestamp,workspaceId);
        for (const old of current?.projects ?? []) if (!nextIds.has(old.id)) db.prepare('DELETE FROM workspace_projects WHERE id=? AND workspace_id=?').run(old.id,workspaceId);
        return this.get(workspaceId)!;
      })();
    },
    sessions(workspaceId) { assert(); if (!this.get(workspaceId)) throw notFound(); return (db.prepare('SELECT * FROM workspace_sessions WHERE workspace_id=? ORDER BY created_at,id').all(workspaceId) as Row[]).map(session); },
    session(workspaceId,id) { assert(); const row = db.prepare('SELECT * FROM workspace_sessions WHERE id=? AND workspace_id=?').get(id,workspaceId) as Row | undefined; return row ? session(row) : null; },
    createSession(workspaceId, defaultProjectId, purpose, key) {
      assert(); return db.transaction(() => {
        const hash = digest({defaultProjectId:defaultProjectId ?? null,purpose});
        const old = db.prepare('SELECT * FROM workspace_sessions WHERE workspace_id=? AND create_request_key=?').get(workspaceId,key) as Row | undefined;
        if (old) { if (old.create_request_sha256 !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT','创建键已用于其他会话内容',409,true); return session(old); }
        const workspace = this.get(workspaceId); if (!workspace) throw notFound();
        const selected = defaultProjectId ?? workspace.defaultProjectId;
        if (!workspace.projects.some(p => p.id === selected)) throw new DomainError('START_PROJECT_UNAVAILABLE','请选择本工作区内的默认项目',409,true);
        const id = randomUUID(), memoryId = randomUUID(), now = new Date().toISOString();
        db.prepare('INSERT INTO session_memories(id,project_id,workspace_id,source_template_id,title,context_json,draft_json,last_reviewed_entry_id,created_at,updated_at) VALUES(?,NULL,?,NULL,?,?,NULL,NULL,?,?)').run(memoryId,workspaceId,purpose,JSON.stringify(emptyContext()),now,now);
        db.prepare('INSERT INTO workspace_sessions VALUES(?,?,?,?,?,NULL,?,?,?,NULL)').run(id,workspaceId,selected,memoryId,purpose,key,hash,now);
        return this.session(workspaceId,id)!;
      })();
    },
    deleteSession(workspaceId,id) { assert(); deleteSessionRecord(db, "workspace", workspaceId, id); },
    bindNative(workspaceId,id,ref) { assert(); db.prepare('UPDATE workspace_sessions SET native_ref_json=? WHERE id=? AND workspace_id=? AND native_ref_json IS NULL AND ended_at IS NULL').run(JSON.stringify(ref),id,workspaceId); const value = this.session(workspaceId,id); if (!value?.nativeRef) throw new DomainError('NO_NATIVE_REF','无法保存会话原生身份',409,true); return value.nativeRef; },
    end(workspaceId,id) { assert(); db.prepare('UPDATE workspace_sessions SET ended_at=? WHERE id=? AND workspace_id=? AND ended_at IS NULL').run(new Date().toISOString(),id,workspaceId); const value = this.session(workspaceId,id); if (!value) throw notFound(); return value; },
    memory(workspaceId,id) { assert(); const row = db.prepare('SELECT * FROM session_memories WHERE id=? AND workspace_id=?').get(id,workspaceId) as Row | undefined; if (!row) throw notFound(); return { id, workspaceId, title: String(row.title), contextJson: validateContext(JSON.parse(String(row.context_json))), lastReviewedEntryId: row.last_reviewed_entry_id as string | null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; },
    updateMemory(workspaceId,id,expected,context,cursor) {
      assert(); return db.transaction(() => {
        const memory = this.memory(workspaceId,id);
        if (workspaceETag(memory) !== expected) throw new DomainError('MEMORY_CONFLICT','记忆已更新，请重新读取',409,true);
        const validated = validateContext(context);
        if (validated.outputs.some(output => output.path !== null)) throw new DomainError('INVALID_INPUT','工作区产出路径请通过文字注明，path 必须为空',422,true);
        db.prepare('UPDATE session_memories SET context_json=?,last_reviewed_entry_id=?,updated_at=? WHERE id=? AND workspace_id=?').run(JSON.stringify(validated),cursor ?? memory.lastReviewedEntryId,new Date(Math.max(Date.now(),Date.parse(memory.updatedAt)+1)).toISOString(),id,workspaceId);
        return this.memory(workspaceId,id);
      })();
    },
  };
  return repository;
}
