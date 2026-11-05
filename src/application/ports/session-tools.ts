import type { JsonObject } from '@/domain/models';
import type { SessionModelView } from '@/domain/session-tools';
import type { SessionRuntimeInput } from './pi-runtime';
export interface SessionToolsRuntimePort {
  models(input: SessionRuntimeInput): Promise<SessionModelView>;
  switchModel(input: SessionRuntimeInput, identity: import('@/domain/session-tools').SessionModelSelection): Promise<SessionModelView>;
  fork(input: SessionRuntimeInput, entryId:string, directory:string): Promise<JsonObject>;
  export(input: SessionRuntimeInput, format:'html'|'jsonl', scope:'tree'|'branch'): Promise<string>;
  operationEvidence(input:SessionRuntimeInput): JsonObject;
  validateForkCandidate(input:SessionRuntimeInput,candidate:JsonObject,entryId:string):JsonObject;
}
