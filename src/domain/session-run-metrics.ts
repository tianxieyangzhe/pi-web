/** Derived from all entries of the owned Pi Session, including compacted history. */
export type SessionTokenUsage = { totalTokens: number | null; complete: boolean };

/** Ephemeral totals for one accepted root message, including its tool loop. */
export type SessionRunMetrics = {
  requestId: string;
  startedAt: string;
  durationMs: number;
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  totalTokens: number | null;
  complete: boolean;
};
