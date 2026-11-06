require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseMessageReferences}=require('../src/domain/message-references.ts');
const {MAX_MESSAGE_BODY_BYTES}=require('../src/domain/message-reference-limits.ts');
let accepts=0;
function accept(_owner,_id,body){parseMessageReferences(body.references);accepts++;return {accepted:true,sessionId:'s'};}
const root=require.resolve('../src/bootstrap/composition-root.server.ts');
require.cache[root]={id:root,filename:root,loaded:true,exports:{services:{projectSessions:{get(){}},sessionTools:{accept}}}};
const {POST}=require('../src/app/api/projects/[projectId]/sessions/[sessionId]/messages/route.ts');
const {createWorkspaceApi}=require('../src/shared/protocol/workspace-api.server.ts');
const workspace=createWorkspaceApi({session(){},accept});
const endpoints=[request=>POST(request,{params:Promise.resolve({projectId:'p',sessionId:'s'})}),request=>workspace(request,['w','sessions','s','messages'])];
const req=(body,headers={})=>new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
test('project and workspace message APIs accept payloads beyond the former JSON limit and reject invalid references',async()=>{
 const data=Buffer.alloc(10*1024*1024,65).toString('base64');
 for(const call of endpoints){
  const before=accepts;let response=await call(req({content:'hello',references:[{name:'large.txt',data}]}));assert.equal(response.status,202);assert.equal(accepts,before+1);
  response=await call(req({content:'hello',references:[{name:'x',data:'bad'}]}));assert.equal(response.status,400);assert.equal(accepts,before+1);
  response=await call(req({content:'hello'},{'content-length':String(MAX_MESSAGE_BODY_BYTES+1)}));assert.equal(response.status,413);assert.equal(accepts,before+1);
 }
});
test('message JSON budget covers base64 padding, maximum body text, and metadata',()=>{
 const base64=Math.ceil(50_000_000/3)*4;
 assert(MAX_MESSAGE_BODY_BYTES>base64+32*1024+10*4096*6);
});
test('JSON body limits streamed bytes without Content-Length before parsing',async()=>{
 const {jsonBody}=require('../src/shared/protocol/api.ts');let cancelled=false;
 const body=new ReadableStream({pull(c){c.enqueue(new Uint8Array(11));},cancel(){cancelled=true;}});
 const request=new Request('http://localhost',{method:'POST',body,duplex:'half'});
 await assert.rejects(()=>jsonBody(request,10),error=>error.status===413);assert.equal(cancelled,true);
});
