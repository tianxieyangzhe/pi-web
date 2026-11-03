import { randomUUID } from "node:crypto";
import { DomainError } from "@/domain/errors";

/** Page presence is independent of transcript identity and background work. */
export class SessionPresence {
  private leases = new Map<string, { id: string; expires: number }>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private detachedAt = new Map<string, number>();
  constructor(private runtime: { busy: (id: string) => boolean; release: (id: string) => Promise<void>; abort: (id: string) => Promise<void> }, private now = () => performance.now()) {}
  open(id: string) { const leaseId = randomUUID(); this.leases.set(leaseId, { id, expires: this.now() + 120_000 }); this.detachedAt.delete(id); this.schedule(id); return leaseId; }
  assertLease = (id: string, leaseId: string) => {
    const lease = this.leases.get(leaseId);
    if (!lease || lease.id !== id || lease.expires <= this.now()) throw new DomainError("RUNTIME_NOT_OPEN", "请重新打开会话", 409, true);
  };
  renew = (id: string, leaseId: string) => { this.assertLease(id, leaseId); this.leases.get(leaseId)!.expires = this.now() + 120_000; this.schedule(id); };
  release = (id: string, leaseId: string) => { if (this.leases.get(leaseId)?.id === id) { this.leases.delete(leaseId); this.schedule(id); } };
  settled(id: string) { this.schedule(id); }
  private schedule(id: string) {
    const previous = this.timers.get(id); if (previous) clearTimeout(previous); this.timers.delete(id);
    const now = this.now();
    for (const [key, lease] of this.leases) if (lease.expires <= now) this.leases.delete(key);
    const live = [...this.leases.values()].filter(lease => lease.id === id);
    if (live.length) { this.detachedAt.delete(id); this.after(id, Math.min(...live.map(lease => lease.expires)) - now, () => this.schedule(id)); return; }
    if (!this.runtime.busy(id)) { this.detachedAt.delete(id); void this.runtime.release(id).catch(() => {}); return; }
    const since = this.detachedAt.get(id) ?? now; this.detachedAt.set(id, since);
    this.after(id, Math.max(1, 300_000 - (now - since)), () => {
      void this.runtime.abort(id).then(() => { if (!this.runtime.busy(id)) this.schedule(id); }).catch(() => { /* Preserve the busy handle when abort cannot be confirmed. */ });
    });
  }
  private after(id: string, ms: number, fn: () => void) { const timer = setTimeout(fn, Math.max(1, ms)); timer.unref?.(); this.timers.set(id, timer); }
}
