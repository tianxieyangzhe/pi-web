require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {api}=require('../web/api/client.ts');
test('project message acceptance is signalled before the stream completes',async()=>{
 const original=global.fetch;let controller,accepted=false;
 global.fetch=async()=>new Response(new ReadableStream({start(c){controller=c;}}),{status:200});
 try {
  const stream=api.sendMessage('p','s','hello',false,()=>{accepted=true;});
  const next=stream.next();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(accepted,true);controller.enqueue(new TextEncoder().encode('{"event":{"type":"message_delta","text":"ok"}}\n'));
  assert.equal((await next).value.text,'ok');controller.close();await stream.next();
 } finally {global.fetch=original;}
});
test('rejected project message is not marked accepted',async()=>{
 const original=global.fetch;let accepted=false;
 global.fetch=async()=>new Response(JSON.stringify({error:{message:'busy'}}),{status:409});
 try {await assert.rejects(()=>api.sendMessage('p','s','hello',false,()=>{accepted=true;}).next(),/busy/);assert.equal(accepted,false);}finally{global.fetch=original;}
});
