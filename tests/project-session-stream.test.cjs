require('./register.cjs');
const { test }=require('node:test'),assert=require('node:assert/strict');
const { agentEventStreamResponse }=require('../src/shared/protocol/agent-event-stream.server.ts');
const {api}=require('../web/api/client.ts');
test('NDJSON preserves native event payload and prevents caching',async()=>{
 async function* source(){yield {type:'pi_event',piType:'message_update',temporaryId:'temp',payload:{assistantMessageEvent:{type:'thinking_delta',delta:'secret'}}};yield {type:'entry_link',temporaryId:'temp',entryId:'entry'};}
 const response=agentEventStreamResponse('session',source());assert.match(response.headers.get('cache-control'),/no-store/);
 const rows=(await response.text()).trim().split('\n').map(JSON.parse);
 assert.deepEqual(rows.map(row=>row.sequence),[1,2]);assert.equal(rows[0].payload.assistantMessageEvent.delta,'secret');assert.equal(rows[1].entryId,'entry');assert.equal(rows[0].runId,rows[1].runId);
});
test('client sends the lease and decodes split UTF-8 events',async()=>{
 const original=global.fetch; let received;
 global.fetch=async(_url,init)=>{received=init;const bytes=new TextEncoder().encode(JSON.stringify({sessionId:'s',runId:'r',sequence:1,type:'message_end',payload:{text:'你好'}}));const split=bytes.indexOf(0xe5)+1;return new Response(new ReadableStream({start(c){c.enqueue(bytes.slice(0,split));c.enqueue(bytes.slice(split));c.close();}}));};
 try {const events=[];for await(const e of api.sendMessage('p','s','lease','hello'))events.push(e);assert.equal(received.headers['x-session-lease-id'],'lease');assert.equal(events[0].payload.text,'你好');assert.equal(events[0].type,'message_end');}finally{global.fetch=original;}
});
test('disconnect does not stop consuming the accepted execution',async()=>{
 let proceed,finished=false;const wait=new Promise(resolve=>{proceed=resolve;});
 async function* source(){yield {type:'session_state',state:'running'};await wait;yield {type:'complete'};finished=true;}
 const response=agentEventStreamResponse('session',source());const reader=response.body.getReader();await reader.read();await reader.cancel();proceed();
 await new Promise(resolve=>setTimeout(resolve,10));assert.equal(finished,true);
});
