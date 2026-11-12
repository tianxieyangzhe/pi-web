export const sessionThinkingLevels = ['off','minimal','low','medium','high','xhigh','max'] as const;
export type SessionThinkingLevel = typeof sessionThinkingLevels[number];
export type SessionModelSelection = {provider:string;modelId:string;thinkingLevel?:SessionThinkingLevel};
export type SessionModelView = {
  thinkingLevel: SessionThinkingLevel | null;
  current: { provider: string; modelId: string; available: boolean; unavailableReason: string | null } | null;
  defaults: { provider: string | null; modelId: string | null };
  models: Array<{ provider: string; modelId: string; name: string; available: boolean; unavailableReason: string | null; contextWindow: number | null; maxTokens: number | null; reasoning: boolean; input: string[]; thinkingLevels:SessionThinkingLevel[] }>;
  sources: { models: 'local' | 'global' | 'native'; settings: 'local' | 'global' | 'native' };
  canSwitch: boolean;
  unavailableReason: string | null;
};
export type SessionOperation = 'create'|'open'|'restore'|'message'|'steer'|'switch-model'|'compact'|'compact-cancel'|'interrupt'|'end'|'adopt-agent'|'fork'|'recover';
export type RecoveryView = { operationId: string; operation: SessionOperation; status: 'running'|'completed'|'failed'|'unknown'|'acknowledged'; resultSessionId: string|null; errorCode: string|null; allowedRecovery: { acknowledgeUnknown: boolean; finalizeFork: boolean } };
export type ActionName = 'send'|'steer'|'interrupt'|'end'|'restore'|'delete'|'compact'|'cancelCompaction'|'switchModel'|'fork'|'export'|'adoptAgent';
export type SessionActions = Record<ActionName, { allowed: boolean; reason: string|null }>;
