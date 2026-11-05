import { createHash } from 'node:crypto';
import { DomainError } from './errors';
import type { SessionOperation } from './session-tools';
export const hash = (value: string|Buffer) => createHash('sha256').update(value).digest('hex');
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string,unknown>)[key])).join(',') + '}';
  return JSON.stringify(value);
}
export function operationIdentity(projectId: string, sessionId: string, operation: SessionOperation, key: string) {
  if (typeof key!=='string'||!/^[\x21-\x7e]{1,128}$/.test(key)) throw new DomainError('INVALID_IDEMPOTENCY_KEY', '请提供1..128个可见ASCII字符的 Idempotency-Key',400,true);
  return hash(JSON.stringify(['project-session-operation-v1',projectId,operation === 'create' ? '' : sessionId,operation,key]));
}
export const createdSessionId = (projectId: string, key: string, sourceId?: string) => 's_' + hash(JSON.stringify(sourceId ? ['session-fork-v1',projectId,sourceId,key] : ['session-create-v1',projectId,key]));
