import { DomainError } from "@/domain/errors";
const state = globalThis as typeof globalThis & {
  __sessionLocks?: Set<string>;
  __sessionUnlockWaiters?: Map<string, Set<() => void>>;
  __sessionDeletions?: Map<string, Promise<unknown>>;
};
export const sessionLocks = state.__sessionLocks ??= new Set<string>();
const waiters = state.__sessionUnlockWaiters ??= new Map<string, Set<() => void>>();
const deletions = state.__sessionDeletions ??= new Map<string, Promise<unknown>>();
export function isSessionDeleting(id: string) { return deletions.has(id); }
export function assertSessionAvailable(id: string) {
  if (isSessionDeleting(id)) throw new DomainError('SESSION_BUSY', '会话正在删除，请等待删除完成', 409, true);
}
export function acquireSession(id: string) {
  assertSessionAvailable(id);
  if (sessionLocks.has(id)) throw new DomainError("SESSION_BUSY", "Session 正在回答或压缩", 409, true);
  sessionLocks.add(id);
}
export function releaseSession(id: string) {
  sessionLocks.delete(id);
  const pending = waiters.get(id);waiters.delete(id);
  for (const resolve of pending ?? []) resolve();
}
export function waitForSessionUnlock(id: string): Promise<void> {
  if (!sessionLocks.has(id)) return Promise.resolve();
  return new Promise(resolve => {
    const pending = waiters.get(id) ?? new Set<() => void>();
    pending.add(resolve);waiters.set(id, pending);
  });
}
export function runSessionDeletion<T>(id: string, work: () => Promise<T>): Promise<T> {
  const pending = deletions.get(id);
  if (pending) return pending as Promise<T>;
  const deletion = Promise.resolve().then(work).finally(() => { deletions.delete(id); });
  deletions.set(id, deletion);
  return deletion;
}
const roots=globalThis as typeof globalThis & {__projectWriteRoots?:Set<string>};
export const projectWriteRoots=roots.__projectWriteRoots??=new Set<string>();
export function acquireProjectWrite(root:string){if(projectWriteRoots.has(root))throw new DomainError('PROJECT_BUSY','同一目录正在修改，请等待当前工作结束',409,true);projectWriteRoots.add(root);}
