import { randomUUID } from "node:crypto";
import { DomainError } from "@/domain/errors";
import { emptyContext, sessionMemoryETag, validateContext, validateDraft, type SessionMemory } from "@/domain/session-memory";
import { database, assertSchemaCompatible } from "./database.server";
import { sessionRepository } from "./session-repository.server";
function map(row: Record<string, unknown>): SessionMemory {
  try { return { id: String(row.id), projectId: row.project_id as string | null, sourceTemplateId: row.source_template_id as string | null, title: String(row.title), contextJson: validateContext(JSON.parse(String(row.context_json)), row.project_id === null), draftJson: row.draft_json ? validateDraft(JSON.parse(String(row.draft_json))) : null, lastReviewedEntryId: row.last_reviewed_entry_id as string | null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
  catch { throw new DomainError("MEMORY_DATA_CORRUPT", "会话上下文数据损坏，已阻止关联写入", 409, true); }
}
function independentOwner() {
  const columns = database.prepare('PRAGMA table_info(session_memories)').all() as Array<{name:string}>;
  return columns.some(column => column.name === 'workspace_id') ? ' AND workspace_id IS NULL' : '';
}
export const sessionMemoryRepository = {
  get(id: string): SessionMemory | null { assertSchemaCompatible(); const row = database.prepare('SELECT * FROM session_memories WHERE id=?' + independentOwner()).get(id) as Record<string, unknown> | undefined; return row ? map(row) : null; },
  templates(): SessionMemory[] { assertSchemaCompatible(); return (database.prepare('SELECT * FROM session_memories WHERE project_id IS NULL' + independentOwner() + ' ORDER BY updated_at DESC').all() as Record<string, unknown>[]).map(map); },
  insert(memory: SessionMemory) { assertSchemaCompatible(); database.prepare('INSERT INTO session_memories(id,project_id,source_template_id,title,context_json,draft_json,last_reviewed_entry_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(memory.id,memory.projectId,memory.sourceTemplateId,memory.title,JSON.stringify(memory.contextJson),memory.draftJson ? JSON.stringify(memory.draftJson) : null,memory.lastReviewedEntryId,memory.createdAt,memory.updatedAt); return memory; },
  createSession(projectId: string, purpose: string, templateId?: string, templateETag?: string, role?:{stableId?:string;agentId:string;agentSnapshot:import("@/domain/models").AgentSnapshot}) {
    assertSchemaCompatible();
    if (!role) {
      const trigger = database.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='session_role_insert'").get() as {sql:string}|undefined;
      if (trigger && /NEW\.agent_id\s+IS\s+NULL/i.test(trigger.sql)) throw new DomainError('SCHEMA_INCOMPATIBLE', '现有数据库要求项目会话绑定角色；需要单独决定离线迁移，历史数据未修改。', 409, true);
    }
    return database.transaction(() => {
      const template = templateId ? this.get(templateId) : null;
      if (templateId && (!template || template.projectId !== null)) throw new DomainError('INVALID_TEMPLATE','SessionMemory 模板不存在',422,true);
      if (template && templateETag !== sessionMemoryETag(template)) throw new DomainError('MEMORY_CONFLICT','模板已更新，请重新预览',409,true);
      const timestamp = new Date().toISOString();
      const memory: SessionMemory = { id: randomUUID(), projectId, sourceTemplateId: template?.id ?? null, title: purpose, contextJson: template?.contextJson ?? emptyContext(), draftJson: null, lastReviewedEntryId: null, createdAt: timestamp, updatedAt: timestamp };
      this.insert(memory);
      return sessionRepository.create({sessionMemoryId:memory.id,projectId,purpose,agentId:role?.agentId??null,agentSnapshot:role?.agentSnapshot??null,mcpIds:[],mcpSnapshots:[],stableId:role?.stableId});
    })();
  },
  update(id: string, expected: string | null, mutate: (memory: SessionMemory) => void): SessionMemory {
    assertSchemaCompatible(); if (!expected) throw new DomainError('PRECONDITION_REQUIRED','缺少内容条件凭据',428,true);
    return database.transaction(() => {
      const memory = this.get(id); if (!memory) throw new DomainError('NOT_FOUND','会话上下文不存在',404,true);
      if (sessionMemoryETag(memory) !== expected) throw new DomainError('MEMORY_CONFLICT','内容已更新，请重新审查',409,true);
      const before = JSON.stringify(memory); mutate(memory); memory.contextJson = validateContext(memory.contextJson,memory.projectId===null); if(memory.draftJson) memory.draftJson=validateDraft(memory.draftJson);
      if (JSON.stringify(memory)===before) return memory;
      memory.updatedAt = new Date(Math.max(Date.now(), Date.parse(memory.updatedAt)+1)).toISOString();
      database.prepare('UPDATE session_memories SET title=?,context_json=?,draft_json=?,last_reviewed_entry_id=?,updated_at=? WHERE id=?').run(memory.title,JSON.stringify(memory.contextJson),memory.draftJson ? JSON.stringify(memory.draftJson) : null,memory.lastReviewedEntryId,memory.updatedAt,id); return memory;
    })();
  }
};
import { contextHash as requireHash } from "@/domain/session-memory";
