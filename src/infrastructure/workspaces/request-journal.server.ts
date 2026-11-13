import { closeSync, fsyncSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {dirname} from 'node:path';
import { DomainError } from '@/domain/errors';

export type WorkspaceRequestIdentity = {
  sessionId: string;
  workspaceId: string;
  nativeSessionId: string;
  sessionFile: string;
};
export type WorkspaceRequestRecord = { type: string; data: unknown };
const types = new Set(['workspace_request', 'workspace_request_result', 'workspace_request_acknowledged']);
const unavailable = () => new DomainError('REQUEST_UNKNOWN', '无法确认应用请求记录的完整性，请检查请求 journal；不能自动重发', 409, true);
const journalFile = (identity: WorkspaceRequestIdentity) => identity.sessionFile + '.workspace-requests.jsonl';
function validData(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const value = data as Record<string, unknown>;
  return typeof value.key === 'string' && !!value.key && typeof value.hash === 'string' && !!value.hash
    && Object.keys(value).every(key => ['key', 'hash', 'outcome', 'operation', 'entryIds'].includes(key))
    && (value.entryIds === undefined || (Array.isArray(value.entryIds) && value.entryIds.every(id => typeof id === 'string' && !!id) && new Set(value.entryIds).size === value.entryIds.length))
    && (value.operation === undefined || value.operation === 'switch-model' || value.operation === 'steer')
    && (value.outcome === undefined || ['settled', 'failed', 'aborted', 'queued'].includes(String(value.outcome)));
}
export function readWorkspaceRequests(identity: WorkspaceRequestIdentity): WorkspaceRequestRecord[] {
  let source: string;
  try { source = readFileSync(journalFile(identity), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw unavailable();
  }
  try {
    if (!source || !source.endsWith('\n')) throw unavailable();
    return source.slice(0, -1).split('\n').map(line => {
      const entry = JSON.parse(line);
      if (!entry || entry.version !== 1 || entry.sessionId !== identity.sessionId
        || entry.workspaceId !== identity.workspaceId || entry.nativeSessionId !== identity.nativeSessionId
        || typeof entry.id !== 'string' || !entry.id || typeof entry.timestamp !== 'string'
        || !types.has(entry.type) || !validData(entry.data)) throw unavailable();
      return { type: entry.type, data: entry.data };
    });
  } catch { throw unavailable(); }
}
export function appendWorkspaceRequest(identity: WorkspaceRequestIdentity, type: string, data: unknown): string {
  if (!types.has(type) || !validData(data)) throw unavailable();
  // Never append past corrupt/partial evidence or a journal belonging to another Session.
  readWorkspaceRequests(identity);
  const id = randomUUID();
  const entry = { version: 1, id, timestamp: new Date().toISOString(), sessionId: identity.sessionId,
    workspaceId: identity.workspaceId, nativeSessionId: identity.nativeSessionId, type, data };
  let fd: number | undefined;
  try {
    fd = openSync(journalFile(identity), 'a', 0o600);
    writeFileSync(fd, JSON.stringify(entry) + '\n', 'utf8');
    fsyncSync(fd);
    const directory=openSync(dirname(journalFile(identity)),'r');try{fsyncSync(directory);}finally{closeSync(directory);}
    return id;
  } catch { throw unavailable(); }
  finally { if (fd !== undefined) closeSync(fd); }
}
