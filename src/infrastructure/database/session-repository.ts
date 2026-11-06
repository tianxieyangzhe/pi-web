import type Database from 'better-sqlite3';
import type { JsonObject, Session } from '@/domain/models';
import type { CreateSessionRecord, SessionRepositoryPort } from '@/application/ports/core';
import { deleteSessionRecord } from './delete-session.server';
import { hydrateAgentSnapshot, serializeAgentSnapshot } from './agent-snapshot.server';
import { DomainError } from '@/domain/errors';
import { randomUUID } from 'node:crypto';

export function createSessionRepository(db: Database.Database, assertWritable: () => void = () => {}): SessionRepositoryPort {
  const states = new Map<string, Session['state']>();
  const json = <T>(value: unknown, fallback: T): T => value == null ? fallback : JSON.parse(String(value));
  function guardNative(ref:JsonObject|null|undefined){if(!ref)return;if(ref.kind!=='pi'||typeof ref.sessionId!=='string'||!ref.sessionId||typeof ref.sessionFile!=='string'||!ref.sessionFile||typeof ref.cwd!=='string'||!ref.cwd)throw new DomainError('NO_NATIVE_REF','原生引用字段无效',409,true);const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE name='workspace_sessions' AND type='table'").get();if(exists&&db.prepare("SELECT 1 FROM workspace_sessions WHERE json_extract(native_ref_json,'$.sessionId')=? OR json_extract(native_ref_json,'$.sessionFile')=? LIMIT 1").get(ref.sessionId,ref.sessionFile))throw new DomainError('REQUEST_UNKNOWN','原生身份已属于其他会话作用域',409,true);}
  function map(row: Record<string, unknown>): Session {
    const ref = json<JsonObject|null>(row.native_ref_json, null);
    const endedAt = row.ended_at as string|null;
    return {
      id: String(row.id), projectId: String(row.project_id), purpose: String(row.purpose ?? ''),
      agentId: row.agent_id as string|null, agentSnapshot: row.agent_snapshot_json ? hydrateAgentSnapshot(json(row.agent_snapshot_json, null)) : null,
      nativeRef: ref, nativeMetadata: {}, mcpIds: [], mcpSnapshots: [],
      status: endedAt ? 'closed' : 'open',
      state: states.get(String(row.id)) ?? (['starting','running','interrupting','unavailable'].includes(String(row.state)) ? 'unavailable' : ref ? 'idle' : 'not_started'),
      endedAt, createdAt: String(row.created_at), updatedAt: String(row.updated_at ?? row.created_at), lastActivityAt: row.last_activity_at as string|null,
      createRequestKeyHash: row.create_request_key_hash as string|null ?? null, createRequestSha256: row.create_request_sha256 as string|null ?? null,
    };
  }
  const repository: SessionRepositoryPort = {
    get(id) { const row = db.prepare('SELECT * FROM sessions WHERE id=?').get(id) as Record<string,unknown>|undefined; return row ? map(row) : null; },
    listForProject(id) { return (db.prepare('SELECT * FROM sessions WHERE project_id=? ORDER BY created_at,id').all(id) as Record<string,unknown>[]).map(map); },
    create(input: CreateSessionRecord) {
      assertWritable();
      const id = input.stableId ?? randomUUID(), now = new Date().toISOString();
      return db.transaction(() => {
        const project = db.prepare('SELECT status FROM projects WHERE id=?').get(input.projectId) as {status:string}|undefined;
        if (project?.status !== 'active') throw new DomainError('PROJECT_UNAVAILABLE', '项目当前不可用', 409, true);
        guardNative(input.nativeRef);
        db.prepare('INSERT INTO sessions(id,project_id,purpose,agent_id,agent_snapshot_json,native_ref_json,create_request_key_hash,create_request_sha256,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,input.projectId,input.purpose,input.agentId,input.agentSnapshot ? JSON.stringify(serializeAgentSnapshot(input.agentSnapshot)) : null,input.nativeRef ? JSON.stringify(input.nativeRef) : null,input.createRequestKeyHash ?? null,input.createRequestSha256 ?? null,now,now);
        return this.get(id)!;
      })();
    },
    updateRuntime(id, patch) {
      // Execution state belongs to this process. It is never an UPDATE of historical state/status columns.
      const current = this.get(id); if (!current) return null;
      if (patch.nativeRef !== undefined || patch.endedAt !== undefined) {
        assertWritable();
        const nativeRef = patch.nativeRef === undefined ? current.nativeRef : patch.nativeRef;
        const endedAt = patch.endedAt === undefined ? current.endedAt : patch.endedAt;
        db.transaction(()=>{guardNative(nativeRef);db.prepare('UPDATE sessions SET native_ref_json=?,ended_at=?,updated_at=? WHERE id=?').run(nativeRef ? JSON.stringify(nativeRef) : null,endedAt,new Date().toISOString(),id);})();
      }
      if (patch.state) states.set(id, patch.state);
      return this.get(id);
    },
    setNativeRefIfAbsent(id, ref) {
      assertWritable();
      return db.transaction(()=>{guardNative(ref);db.prepare('UPDATE sessions SET native_ref_json=?,updated_at=? WHERE id=? AND native_ref_json IS NULL').run(JSON.stringify(ref),new Date().toISOString(),id);
      const result = this.get(id);
      if (result?.nativeRef && JSON.stringify(result.nativeRef) !== JSON.stringify(ref)) throw new DomainError('REQUEST_UNKNOWN', '会话已有不同原生身份', 409, true);
      return result;})();
    },
    adoptAgent(id, expected, snapshot) {
      assertWritable();
      return db.transaction(() => {
        const result=db.prepare('UPDATE sessions SET agent_snapshot_json=?,updated_at=? WHERE id=? AND agent_id=? AND agent_snapshot_json=? AND updated_at=?').run(JSON.stringify(serializeAgentSnapshot(snapshot)),new Date().toISOString(),id,snapshot.agentId,JSON.stringify(serializeAgentSnapshot(expected.agentSnapshot)),expected.updatedAt);
        if(result.changes!==1)throw new DomainError('WRITE_CONFLICT','会话已变化，请重新读取',409,true);
        return this.get(id)!;
      })();
    },
    markInterruptedAfterRestart() { return 0; },
    delete(projectId, id) { assertWritable(); deleteSessionRecord(db,'project',projectId,id); states.delete(id); },
  };
  return repository;
}
