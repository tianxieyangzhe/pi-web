import type { AgentSnapshot, AgentSnapshotRef } from '@/domain/models';
export type AssistantIdentity={scope:'project'|'workspace';ownerId:string;sessionId:string};
export type AssistantSelection={selection:AgentSnapshotRef|null;writeETag:string};
export interface SessionAssistantStore {
  read(identity:AssistantIdentity,fallback?:AgentSnapshotRef|null):AssistantSelection;
  write(identity:AssistantIdentity,selection:AgentSnapshotRef|null,etag:string,fallback?:AgentSnapshotRef|null):AssistantSelection;
  inUse(agentId:string):boolean;
}
export interface SessionAssistantAccess {
  read(identity:AssistantIdentity,fallback?:AgentSnapshot|null):AssistantSelection;
  resolve(identity:AssistantIdentity,fallback?:AgentSnapshot|null):AgentSnapshot|null;
  write(identity:AssistantIdentity,body:Record<string,unknown>,etag:string,fallback?:AgentSnapshot|null):AssistantSelection;
}
