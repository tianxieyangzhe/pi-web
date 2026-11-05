import type { JsonObject } from '@/domain/models';
import type { SessionOperation } from '@/domain/session-tools';
export type OperationRecord = { version: 1; sequence: number; previousHash: string|null; recordHash: string; timestamp: string; operationId: string; projectId: string; sessionId: string; operation: SessionOperation; keyHash: string; payloadSha256: string; phase: 'prepared'|'observed'|'completed'|'failed'|'acknowledged'; evidence: JsonObject };
export interface ProjectOperationStore {
  prepare(projectId: string, sessionId: string, operation: SessionOperation, key: string, payload: unknown, evidence?: JsonObject): OperationRecord;
  read(projectId: string, operationId: string): OperationRecord[];
  append(record: OperationRecord, phase: OperationRecord['phase'], evidence?: JsonObject): OperationRecord;
  list(projectId: string, sessionId?: string): OperationRecord[];
  directory(record: OperationRecord): string;
}
