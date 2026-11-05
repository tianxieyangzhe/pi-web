import type Database from 'better-sqlite3';
import { DomainError } from '@/domain/errors';

/** Application guards must hold the session lock before calling this transaction. */
export function deleteSessionRecord(db: Database.Database, kind: 'project' | 'workspace', ownerId: string, id: string) {
  const table = kind === 'workspace' ? 'workspace_sessions' : 'sessions';
  const owner = kind === 'workspace' ? 'workspace_id' : 'project_id';
  try {
    db.transaction(() => {
      const row = db.prepare(`SELECT * FROM ${table} WHERE id=? AND ${owner}=?`).get(id, ownerId) as Record<string, unknown> | undefined;
      if (!row) throw new DomainError('NOT_FOUND', '会话不存在', 404, true);
      if (kind === 'project' && row.bot_conversation_id) throw new DomainError('SESSION_REFERENCED', '此会话关联历史 Bot，不能删除', 409, true);
      db.prepare(`DELETE FROM ${table} WHERE id=? AND ${owner}=?`).run(id, ownerId);
      const removed = db.prepare(`DELETE FROM session_memories WHERE id=? AND ${owner}=?`).run(row.session_memory_id, ownerId);
      if (removed.changes !== 1) throw new DomainError('MEMORY_DATA_CORRUPT', '会话记忆归属不一致，删除已回滚', 409, true);
    })();
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    if (failure.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || failure.code === 'SQLITE_CONSTRAINT_TRIGGER' && failure.message === 'FOREIGN KEY constraint failed') throw new DomainError('SESSION_REFERENCED', '会话或记忆仍被历史记录引用，不能删除', 409, true);
    throw error;
  }
}
