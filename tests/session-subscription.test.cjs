require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {SessionEvents}=require('../src/application/session-events.ts');
const {sessionEventResponse}=require('../src/shared/protocol/session-event-response.server.ts');
function fixture(){
 let now=0;const leases=new Map([['a','s'],['b','s'],['c','other']]),renewed=[],released=[];
 const events=new SessionEvents({assertLease:(id,l)=>{assert.equal(leases.get(l),id);},renew:(id,l)=>renewed.push([id,l]),release:(id,l)=>{released.push([id,l]);leases.delete(l);}},()=>now);
 return {events,renewed,released,advance:ms=>now+=ms};
}
test('server challenges require exact session, connection, challenge and deadline; pages are independent',()=>{
 const f=fixture(),a=[],b=[];let closed=0;
 const closeA=f.events.subscribe('s','a',frame=>a.push(frame),()=>closed++),closeB=f.events.subscribe('s','b',frame=>b.push(frame),()=>closed++);
 try{
  const ping=a.find(x=>x.event==='ping').data,other=b.find(x=>x.event==='ping').data;
  assert.throws(()=>f.events.pong('other',ping.connectionId,ping.challenge),e=>e.code==='SESSION_SUBSCRIPTION_EXPIRED');
  assert.throws(()=>f.events.pong('s',ping.connectionId,other.challenge),e=>e.code==='SESSION_SUBSCRIPTION_EXPIRED');
  assert.equal(f.renewed.length,0);
  f.events.pong('s',ping.connectionId,ping.challenge);assert.deepEqual(f.renewed,[['s','a']]);
  assert.throws(()=>f.events.pong('s',ping.connectionId,ping.challenge),e=>e.code==='SESSION_SUBSCRIPTION_EXPIRED');
  f.advance(90_001);assert.throws(()=>f.events.pong('s',other.connectionId,other.challenge),e=>e.code==='SESSION_SUBSCRIPTION_EXPIRED');
  f.events.ping(other.connectionId);assert.deepEqual(f.released,[['s','b']]);
  const before=a.length;f.events.agent('s',{type:'pi_event',piType:'agent_start',temporaryId:null,payload:{type:'agent_start'}});
  f.events.agent('s',{type:'pi_event',piType:'message_update',temporaryId:'tmp',payload:{thinking:'secret',tool:{password:'raw'}}});
  f.events.agent('s',{type:'entry_link',temporaryId:'tmp',entryId:'persisted'});
  const frames=a.slice(before).map(x=>x.data);assert.equal(frames.length,3);assert.equal(frames[0].runId,frames[2].runId);assert.deepEqual(frames.map(x=>x.sequence),[1,2,3]);assert.equal(frames[1].payload.tool.password,'raw');assert.equal(frames[2].entryId,'persisted');
  assert.equal(b.filter(x=>x.event==='message').length,0);
 }finally{closeA();closeB();}assert.equal(closed,2);
});
test('SSE disconnect releases only its lease and does not fabricate a terminal event',async()=>{
 const f=fixture();const response=sessionEventResponse(new Request('http://local/events'),f.events,'s','a');
 assert.match(response.headers.get('cache-control'),/no-store/);assert.match(response.headers.get('content-type'),/text\/event-stream/);
 const reader=response.body.getReader();const first=new TextDecoder().decode((await reader.read()).value);assert.match(first,/event: ready/);
 const second=new TextDecoder().decode((await reader.read()).value);assert.match(second,/event: ping/);
 await reader.cancel();assert.deepEqual(f.released,[['s','a']]);assert.doesNotMatch(first+second,/complete|failed/);
});
test('request abort closes the subscription and releases presence',async()=>{
 const f=fixture(),abort=new AbortController();const response=sessionEventResponse(new Request('http://local/events',{signal:abort.signal}),f.events,'s','a');
 const reader=response.body.getReader();await reader.read();await reader.read();abort.abort();assert.equal((await reader.read()).done,true);assert.equal(f.released.length,1);
});
