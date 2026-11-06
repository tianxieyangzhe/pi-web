import type {SessionState} from "./models";
export type NativeContextInspection = {
  sessionState: SessionState;
  runtimeReady: boolean;
  canCancelCompaction: boolean;
  usage: { usedTokens: number | null; contextWindowTokens: number | null; remainingTokens: number | null; usageRatio: number | null; measurement: "native" | "estimated" | "unavailable"; measuredAt: string | null; freshness: "current" | "last_known" | "unavailable" };
  autoCompactionEnabled: boolean;
  compactionState: "idle" | "running" | "cancelled" | "failed";
  canCompact: boolean;
  unavailableReason: string | null;
  lastCompactedAt: string | null;
  error: { code: string; message: string; recoverable: boolean } | null;
};
export const emptyInspection = (reason: string): NativeContextInspection => ({ sessionState:"not_started",runtimeReady:false,canCancelCompaction:false,usage: { usedTokens: null, contextWindowTokens: null, remainingTokens: null, usageRatio: null, measurement: "unavailable", measuredAt: null, freshness: "unavailable" }, autoCompactionEnabled: true, compactionState: "idle", canCompact: false, unavailableReason: reason, lastCompactedAt: null, error: null });
