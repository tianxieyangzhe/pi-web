import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { AgentEvent } from '@/domain/models';
import type { SessionRunMetrics, SessionTokenUsage } from '@/domain/session-run-metrics';

/** Pi getSessionStats accounting scope, using the tree already read by messages. */
export function sessionTokenUsage(entries: ReadonlyArray<{ entry: unknown }>): SessionTokenUsage {
  let totalTokens = 0, reported = false, complete = true;
  for (const { entry: value } of entries) {
    const entry = value as { type?: string; usage?: unknown; message?: { role?: string; usage?: unknown; stopReason?: string } };
    const message = entry.message;
    const assistant = entry.type === 'message' && message?.role === 'assistant';
    const usage = entry.type === 'message'
      ? assistant || message?.role === 'toolResult' ? message?.usage : undefined
      : ['usage', 'compaction', 'branch_summary'].includes(entry.type ?? '') ? entry.usage : undefined;
    if (!assistant && usage === undefined) continue;
    const data = usage as Record<string, unknown> | null | undefined;
    const fields = ['input', 'output', 'cacheRead', 'cacheWrite'];
    if (!data || fields.some(key => typeof data[key] !== 'number' || !Number.isFinite(data[key]) || (data[key] as number) < 0)) {
      complete = false; continue;
    }
    const tokens = fields.reduce((sum, key) => sum + (data[key] as number), 0);
    if (assistant && ['error', 'aborted'].includes(message?.stopReason ?? '') && tokens === 0) {
      complete = false; continue;
    }
    reported = true;
    totalTokens += tokens;
  }
  return { totalTokens: reported || complete ? totalTokens : null, complete };
}

/** Collect only events produced by this root send; never inspect session history. */
export function createSessionRunMetrics() {
  const requestId = randomUUID(), startedAt = new Date().toISOString(), since = performance.now();
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
  const seen = new Set<unknown>();
  let responses = 0, incomplete = false;
  return {
    started(): AgentEvent { return { type: 'run_started', requestId, startedAt }; },
    observe(event: AgentEvent) {
      if (event.type !== 'pi_event' || event.piType !== 'message_end') return;
      const message = (event.payload as { message?: { role?: string; usage?: Record<string, unknown>; stopReason?: string } })?.message;
      if (message?.role !== 'assistant') return;
      const identity = event.temporaryId ?? message;
      if (seen.has(identity)) return;
      seen.add(identity);
      const usage = message.usage;
      if (!usage || Object.keys(totals).some(key => typeof usage[key] !== 'number' || !Number.isFinite(usage[key]) || (usage[key] as number) < 0)) {
        incomplete = true; return;
      }
      if (['error', 'aborted'].includes(message.stopReason ?? '') && usage.totalTokens === 0) { incomplete = true; return; }
      responses++;
      for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += usage[key] as number;
    },
    finish(failed = false): AgentEvent {
      const metrics: SessionRunMetrics = {
        requestId, startedAt, durationMs: Math.max(0, Math.round(performance.now() - since)),
        input: responses ? totals.input : null, output: responses ? totals.output : null,
        cacheRead: responses ? totals.cacheRead : null, cacheWrite: responses ? totals.cacheWrite : null,
        totalTokens: responses ? totals.totalTokens : null, complete: responses > 0 && !incomplete && !failed,
      };
      return { type: 'run_metrics', ...metrics };
    },
  };
}
