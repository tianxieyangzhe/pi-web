require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {SessionPresence}=require('../src/application/session-presence.ts');
test('last page disconnect keeps busy coordinator; reopening cancels timeout; idle settlement releases',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let now=0,busy=true,released=0,aborts=0;
 const presence=new SessionPresence({busy:()=>busy,release:async()=>{released++;},abort:async()=>{aborts++;}},()=>now);
 const a=presence.open('s'),b=presence.open('s');presence.release('s',a);presence.assertLease('s',b);assert.equal(released,0);
 presence.release('s',b);now+=299_000;t.mock.timers.tick(299_000);assert.equal(aborts,0);
 const c=presence.open('s');now+=1000;t.mock.timers.tick(1000);assert.equal(aborts,0);presence.assertLease('s',c);
 busy=false;presence.release('s',c);assert.equal(released,1);
});
test('server timeout requests abort and never disposes a still busy runtime',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let now=0,busy=true,released=0,aborts=0;
 const presence=new SessionPresence({busy:()=>busy,release:async()=>{released++;},abort:async()=>{aborts++;}},()=>now);
 const lease=presence.open('s');presence.release('s',lease);now+=300_000;t.mock.timers.tick(300_000);await Promise.resolve();
 assert.equal(aborts,1);assert.equal(released,0);busy=false;presence.settled('s');assert.equal(released,1);
});
