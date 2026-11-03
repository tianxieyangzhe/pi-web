require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {subscribeSession,submitSessionMessage}=require('../web/api/session-events.ts');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('browser sends no periodic renewal; only server ping triggers pong; ready precedes history refresh',async()=>{
 const previousFetch=global.fetch,previousSource=global.EventSource,calls=[];let source,ready=false,received;
 class FakeSource{constructor(url){this.url=url;this.listeners={};source=this;}addEventListener(name,fn){this.listeners[name]=fn;}close(){this.closed=true;}}
 global.EventSource=FakeSource;global.fetch=async(url,init)=>{calls.push({url,init});return url.endsWith('/open')?Response.json({data:{leaseId:'lease',status:'ready',outcome:null}}):new Response(null,{status:204});};
 let close;
 try{
  close=subscribeSession('/session',{onReady:()=>{ready=true;},onEvent:event=>received=event,onError:error=>{throw error;}});
  await flush();assert.equal(calls.length,1);assert.match(source.url,/leaseId=lease/);assert.equal(ready,false);
  source.listeners.ready();await flush();assert.equal(ready,true);assert.equal(calls.length,1);
  source.listeners.ping({data:JSON.stringify({connectionId:'connection',challenge:'nonce'})});await flush();assert.equal(calls.length,2);assert.match(calls[1].url,/runtime\/pong$/);assert.deepEqual(JSON.parse(calls[1].init.body),{connectionId:'connection',challenge:'nonce'});
  source.onmessage({data:'{"sessionId":"s","type":"message_update"}'});assert.equal(received.sessionId,'s');
  close();assert.equal(source.closed,true);assert.equal(calls.length,3);assert.match(calls[2].url,/runtime\/close$/);
 }finally{close?.();global.fetch=previousFetch;global.EventSource=previousSource;}
});
test('disconnect reopens a new subscription without resubmitting a message',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const oldFetch=global.fetch,oldSource=global.EventSource,calls=[],sources=[];let opens=0,ready=0;
 class FakeSource{constructor(url){this.url=url;this.listeners={};sources.push(this);}addEventListener(name,fn){this.listeners[name]=fn;}close(){this.closed=true;}}
 global.EventSource=FakeSource;global.fetch=async(url)=>{calls.push(url);return url.endsWith('/open')?Response.json({data:{leaseId:'lease-'+(++opens),status:'running',outcome:null}}):new Response(null,{status:204});};
 let close;
 try{
  close=subscribeSession('/session',{onReady:()=>{ready++;},onEvent:()=>{},onError:()=>{}});await flush();sources[0].listeners.ready();assert.equal(ready,1);
  sources[0].onerror();assert.equal(sources[0].closed,true);t.mock.timers.tick(2000);await flush();assert.equal(opens,2);assert.match(sources[1].url,/lease-2/);
  sources[0].listeners.ready();assert.equal(ready,1);sources[1].listeners.ready();assert.equal(ready,2);assert.equal(calls.some(url=>url.endsWith('/messages')),false);
 }finally{close?.();global.fetch=oldFetch;global.EventSource=oldSource;}
});
test('JSON submit is independent of subscription and preserves rejected input semantics',async()=>{
 const previous=global.fetch;let init;
 global.fetch=async(_url,value)=>{init=value;return Response.json({data:{accepted:true,sessionId:'s'}},{status:202});};
 try{
  assert.equal((await submitSessionMessage('/session','lease','你好')).accepted,true);assert.equal(init.headers.accept,'application/json');assert.equal(init.headers['x-session-lease-id'],'lease');assert.equal(JSON.parse(init.body).content,'你好');
  global.fetch=async()=>Response.json({error:{message:'会话繁忙'}},{status:409});await assert.rejects(()=>submitSessionMessage('/session','lease','retain'),/会话繁忙/);
 }finally{global.fetch=previous;}
});
