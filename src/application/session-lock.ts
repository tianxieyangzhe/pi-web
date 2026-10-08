import { DomainError } from "@/domain/errors";
const state = globalThis as typeof globalThis & { __sessionLocks?: Set<string> };
export const sessionLocks = state.__sessionLocks ??= new Set<string>();
export function acquireSession(id: string) { if (sessionLocks.has(id)) throw new DomainError("SESSION_BUSY", "Session 正在回答或压缩", 409, true); sessionLocks.add(id); }
