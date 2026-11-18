export type ApplicationChange = { topic: 'catalog' | 'sessions' | 'session' | 'rules' | 'context-files'; key?: string };
type Listener = (change: ApplicationChange) => void;
const state = globalThis as typeof globalThis & { __applicationChangesV1?: Set<Listener> };
const listeners = state.__applicationChangesV1 ??= new Set<Listener>();

/** Invalidation only: no transcript, durable log, Runtime ownership or polling. */
export const applicationChanges = {
  subscribe(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  publish(change: ApplicationChange) { for (const listener of [...listeners]) { try { listener(change); } catch { /* Transport failure must not fail a committed mutation. */ } } },
};

/** Repository methods here are synchronous and return only after their transaction commits. */
export function observeRepository<T extends object>(repository: T, methods: Partial<Record<keyof T, ApplicationChange['topic'][]>>): T {
  return new Proxy(repository, {
    get(target, key, receiver) {
      const method = Reflect.get(target, key, receiver), topics = methods[key as keyof T];
      if (typeof method !== 'function' || !topics) return method;
      return (...args: unknown[]) => {
        const value = Reflect.apply(method, target, args);
        for (const topic of topics) applicationChanges.publish({ topic });
        return value;
      };
    },
  });
}
