import { randomUUID } from "node:crypto";
import { DomainError } from "@/domain/errors";
import type { AgentEvent } from "@/domain/models";

export type SessionEvent = { sessionId: string; runId: string | null; sequence: number | null; type: string; entryId: string | null; temporaryId: string | null; payload: unknown };
export type SubscriptionFrame = { event: "ready" | "ping" | "message"; data: unknown };

type RunSnapshot = { start: SessionEvent; latest: SessionEvent | null; at: number };
const processState = globalThis as typeof globalThis & { __sessionRunMetricsV1?: Map<string, RunSnapshot> };

/** Process-local observers and server-issued challenges; never persistent history. */
export class SessionEvents {
  private connections = new Map<string, { sessionId: string; leaseId: string; challenge: string | null; deadline: number; send: (frame: SubscriptionFrame) => void; close: () => void }>();
  private metrics = processState.__sessionRunMetricsV1 ??= new Map<string, RunSnapshot>();
  private runs = new Map<string, { id: string; sequence: number; started: boolean }>();
  constructor(private presence: { assertLease: (id: string, lease: string) => void; renew: (id: string, lease: string) => void; release: (id: string, lease: string) => void }, private clock = () => performance.now(),private activity:(sessionId:string)=>unknown=()=>null) {}

  subscribe(sessionId: string, leaseId: string, send: (frame: SubscriptionFrame) => void, end: () => void) {
    this.presence.assertLease(sessionId, leaseId);
    if ([...this.connections.values()].some(c => c.leaseId === leaseId)) throw new DomainError("SESSION_SUBSCRIPTION_EXISTS", "此使用权已经订阅", 409, true);
    const connectionId = randomUUID();
    let timer: ReturnType<typeof setInterval> | undefined;
    const close = () => {
      if (!this.connections.delete(connectionId)) return;
      if (timer) clearInterval(timer);
      this.presence.release(sessionId, leaseId);
      end();
    };
    this.connections.set(connectionId, { sessionId, leaseId, challenge: null, deadline: 0, send, close });
    try {
      const stats=this.metrics.get(sessionId);
      const runMetrics=stats?{...(stats.start.payload as object),durationMs:0,input:null,output:null,cacheRead:null,cacheWrite:null,totalTokens:null,complete:false,...(stats.latest?.payload as object??{}),...(stats.latest?.type==='run_metrics'?{}:{durationMs:((stats.latest?.payload as {durationMs:number}|undefined)?.durationMs??0)+Math.max(0,this.clock()-stats.at)})}:null;
      send({ event: "ready", data: { connectionId,activity:this.activity(sessionId),runMetrics } });
      if(stats){
        send({event:'message',data:{...stats.start,runId:null,sequence:null}});
        if(stats.latest){
          const payload=stats.latest.payload as {durationMs:number};
          send({event:'message',data:{...stats.latest,runId:null,sequence:null,payload:{...payload,durationMs:payload.durationMs+(stats.latest.type==='run_progress'?Math.max(0,this.clock()-stats.at):0)}}});
        } else {
          send({event:'message',data:{...stats.start,type:'run_progress',runId:null,sequence:null,payload:{...(stats.start.payload as object),durationMs:Math.max(0,this.clock()-stats.at),input:null,output:null,cacheRead:null,cacheWrite:null,totalTokens:null,complete:false}}});
        }
      }
      this.ping(connectionId);
      timer = setInterval(() => this.ping(connectionId), 30_000); timer.unref?.();
    } catch (error) { close(); throw error; }
    return close;
  }
  closeSession(sessionId:string,forgetMetrics=false){if(forgetMetrics)this.metrics.delete(sessionId);this.runs.delete(sessionId);for(const c of [...this.connections.values()])if(c.sessionId===sessionId){try{c.send({event:"message",data:{sessionId,runId:null,sequence:null,type:"session_closed",entryId:null,temporaryId:null,payload:{status:"closed"}}});}catch{/* A broken transport still releases its lease. */}finally{c.close();}}}
  // Public for controlled-clock lifecycle tests; only the server invokes this.
  ping(connectionId: string) {
    const c = this.connections.get(connectionId); if (!c) return;
    if (c.challenge) { if (this.clock() >= c.deadline) c.close(); return; }
    c.challenge = randomUUID(); c.deadline = this.clock() + 90_000;
    try { c.send({ event: "ping", data: { connectionId, challenge: c.challenge } }); } catch { c.close(); }
  }
  pong(sessionId: string, connectionId: string, challenge: string) {
    const c = this.connections.get(connectionId);
    if (!c || c.sessionId !== sessionId || !c.challenge || c.challenge !== challenge || this.clock() >= c.deadline) throw new DomainError("SESSION_SUBSCRIPTION_EXPIRED", "订阅心跳已失效，请重新打开会话", 409, true);
    this.presence.renew(sessionId, c.leaseId); c.challenge = null;
  }
  publish(sessionId: string, event: SessionEvent) {
    if(event.type==='run_started')this.metrics.set(sessionId,{start:event,latest:null,at:this.clock()});
    if(event.type==='run_progress'||event.type==='run_metrics'){const stats=this.metrics.get(sessionId);if(stats&&(stats.start.payload as {requestId:string}).requestId===(event.payload as {requestId:string}).requestId){stats.latest=event;stats.at=this.clock();}}
    for (const c of [...this.connections.values()]) if (c.sessionId === sessionId) {
      try { c.send({ event: "message", data: event }); } catch { c.close(); }
    }
  }
  agent(sessionId: string, event: AgentEvent) {
    const native = event.type === "pi_event", link = event.type === "entry_link";
    if (event.type === "session_state" && event.state === "starting") this.runs.set(sessionId, { id: randomUUID(), sequence: 0, started: false });
    let run = this.runs.get(sessionId);
    if (native && event.piType === "agent_start") {
      if (!run || run.started) { run = { id: randomUUID(), sequence: 0, started: true }; this.runs.set(sessionId, run); }
      else run.started = true;
    }
    if (!run && (native || link || event.type === "session_state")) { run = { id: randomUUID(), sequence: 0, started: false }; this.runs.set(sessionId, run); }
    this.publish(sessionId, { sessionId, runId: run?.id ?? null, sequence: run ? ++run.sequence : null, type: native ? event.piType : event.type, entryId: link ? event.entryId : null, temporaryId: native || link ? event.temporaryId : null, payload: native ? event.payload : event });
  }
}
