require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const root=require.resolve('../src/bootstrap/composition-root.server.ts');let sends=0;
const {parseMessageReferences}=require('../src/domain/message-references.ts');
const execution={referenceContractVersion:3,send(_id,_text,_op,refs){parseMessageReferences(refs,new Set(['p']),()=>({name:'x',data:'eA=='}));return (async function*(){sends++;yield {type:'complete'};})();}};
require.cache[root]={id:root,filename:root,loaded:true,exports:{services:{projectSessions:{get(){}},bots:{participantForSession:()=>null},execution}}};
const {POST}=require('../src/app/api/projects/[projectId]/sessions/[sessionId]/messages/route.ts');
const context={params:Promise.resolve({projectId:'p',sessionId:'s'})};
const req=refs=>new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:'hello',references:refs})});
test('project upload rejects stale service and invalid bytes before acceptance',async()=>{
 let response=await POST(req([{name:'x',data:'eA=='}]),context);assert.equal(response.status,503);response=await POST(req(undefined),context);assert.equal(response.status,503);assert.equal(sends,0);execution.referenceContractVersion=6;
 response=await POST(req([{name:'x',data:'bad'}]),context);assert.equal(response.status,400);assert.equal(sends,0);
 response=await POST(req([{name:'x',data:'eA=='}]),context);assert.equal(response.status,200);await response.text();assert.equal(sends,1);
});
test('JSON body limits streamed bytes before parsing',async()=>{
 const {jsonBody}=require('../src/shared/protocol/api.ts');let cancelled=false;
 const body=new ReadableStream({pull(c){c.enqueue(new Uint8Array(11));},cancel(){cancelled=true;}});
 const request=new Request('http://localhost',{method:'POST',body,duplex:'half'});
 await assert.rejects(()=>jsonBody(request,10),error=>error.status===413);assert.equal(cancelled,true);
});
