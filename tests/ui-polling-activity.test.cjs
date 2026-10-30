require('./register.cjs');
const {test}=require('node:test');const assert=require('node:assert/strict');
const {memoryPollingDelay,createAdaptivePoller}=require('../web/workspace/conversation/project-session/session-memory-polling.ts');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('memory polling follows pending work and stops synced hidden panels',()=>{
 assert.equal(memoryPollingDelay({syncState:'updating'},false,0,100),2000);
 assert.equal(memoryPollingDelay({syncState:'pending'},true,0,100),2000);
 assert.equal(memoryPollingDelay({syncState:'synced'},false,0,100),null);
 assert.equal(memoryPollingDelay({syncState:'synced'},true,0,100),30000);
 assert.equal(memoryPollingDelay({syncState:'synced'},false,5000,100),2000);
 assert.equal(memoryPollingDelay({syncState:'failed'},false,5000,100),null);
 assert.equal(memoryPollingDelay(null,false,0,100,true),null);
});
test('adaptive polling deduplicates refreshes and waits for completion before next timer',async()=>{
 let calls=0,finish;const timers=new Map();let next=0,visible=true,delay=2000;const received=[];
 const loop=createAdaptivePoller({request:()=>{calls++;return new Promise(resolve=>{finish=resolve;});},receive:value=>received.push(value),error:()=>{},delay:()=>delay,visible:()=>visible,setTimer:callback=>{const id=++next;timers.set(id,callback);return id;},clearTimer:id=>timers.delete(id)});
 const first=loop.refresh(),second=loop.refresh();assert.equal(first,second);await settle();assert.equal(calls,1);assert.equal(timers.size,0);
 finish('updated');await first;assert.deepEqual(received,['updated']);assert.equal(timers.size,1);
 visible=false;loop.pause();await loop.refresh();assert.equal(timers.size,0);assert.equal(calls,1);
 visible=true;delay=null;const third=loop.refresh();await settle();finish('synced');await third;assert.equal(timers.size,0);
 loop.dispose();
});
test('disposing a pending poll ignores its late result and creates no future request',async()=>{
 let finish;let received=0,timers=0;
 const loop=createAdaptivePoller({request:()=>new Promise(resolve=>{finish=resolve;}),receive:()=>received++,error:()=>{},delay:()=>2000,visible:()=>true,setTimer:()=>{timers++;return 1;},clearTimer:()=>{}});
 const pending=loop.refresh();await settle();loop.dispose();finish({});await pending;assert.equal(received,0);assert.equal(timers,0);
});
