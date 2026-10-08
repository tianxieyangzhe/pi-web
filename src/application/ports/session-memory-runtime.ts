import type { SessionMemoryContext } from "@/domain/session-memory";
import type { SessionRuntimeInput } from "./pi-runtime";
export type SummaryRequest = { afterId: string; throughId: string; user: string; assistant: string; completed: boolean; createdAt: string };
export type SessionMemoryHistory = { entryIds: string[]; requests: SummaryRequest[] };
export interface SessionMemoryRuntimePort {
  history(input: SessionRuntimeInput): Promise<SessionMemoryHistory>;
  summarize(context: SessionMemoryContext, requests: SummaryRequest[], cwd: string): Promise<{ context: unknown; inputTokens: number | null; outputTokens: number | null }>;
}
