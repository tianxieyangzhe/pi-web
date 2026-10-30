require('./register.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {agentEventStreamResponse}=require('../src/shared/protocol/agent-event-stream.server.ts');
const {api}=require('../web/api/client.ts');

test('server enqueue and browser receive are correlated before stream completion without logging content',async()=>{
 const originalFetch=global.fetch,originalInfo=console.info,lines=[];
 let release;
 const wait=new Promise(resolve=>{release=resolve;});
 console.info=line=>lines.push(line);
 global.fetch=async()=>agentEventStreamResponse('session-test',(async function*(){
   yield {type:'session_state',state:'running'};
   yield {type:'message_delta',text:'private output'};
   yield {type:'message_delta',text:'more private output'};
   await wait;
   yield {type:'complete'};
 })());
 try {
   const stream=api.sendMessage('project-test','session-test','private prompt');
   assert.equal((await stream.next()).value.type,'session_state');
   assert.equal((await stream.next()).value.text,'private output');
   assert.equal((await stream.next()).value.text,'more private output');
   let data=lines.map(line=>JSON.parse(line.slice(line.indexOf('{'))));
   assert.deepEqual(data.map(x=>x.stage),['first_text_enqueued','first_text_received']);
   assert.equal(data[0].turnId,data[1].turnId);
   assert.ok(data.every(x=>x.sessionId==='session-test' && typeof x.elapsedMs==='number' && !Number.isNaN(Date.parse(x.at))));
   release();
   assert.equal((await stream.next()).value.type,'complete');
   assert.equal((await stream.next()).done,true);
   data=lines.map(line=>JSON.parse(line.slice(line.indexOf('{'))));
   assert.deepEqual(data.map(x=>x.stage),['first_text_enqueued','first_text_received','complete_enqueued','complete_received']);
   assert.ok(data.every(x=>x.turnId===data[0].turnId));
   assert.doesNotMatch(lines.join('\n'),/private/);
 } finally {release();global.fetch=originalFetch;console.info=originalInfo;}
});

test('browser logs a split final line even without newline, and logging errors do not affect events',async()=>{
 const originalFetch=global.fetch,originalInfo=console.info;
 console.info=()=>{throw new Error('log failed');};
 global.fetch=async()=>new Response(new ReadableStream({start(c){
   const encoder=new TextEncoder();
   c.enqueue(encoder.encode('{"turnId":"t","sessionId":"s","event":{"type":"message_'));
   c.enqueue(encoder.encode('delta","text":"ok"}}'));c.close();
 }}));
 try {
   const stream=api.sendMessage('p','s','hello');
   assert.equal((await stream.next()).value.text,'ok');
   assert.equal((await stream.next()).done,true);
 } finally {global.fetch=originalFetch;console.info=originalInfo;}
});
