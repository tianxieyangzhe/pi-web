const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./workspace-fixture.cjs');
const {createWorkspaceApi}=require('../src/shared/protocol/workspace-api.server.ts');
const {jsonBody}=require('../src/shared/protocol/api.ts');

test('workspace runtime open accepts zero-byte streams without weakening JSON or field validation',async()=>{
 const f=fixture();try{
  const w=await f.service.save(null,{name:'Work',projects:[{rootPath:f.a}],defaultProjectIndex:0},'w');
  const s=f.service.createSession(w.id,{},'s'),handle=createWorkspaceApi(f.service),base=[w.id,'sessions',s.id];
  const call=(action,body,extraHeaders={})=>handle(new Request('http://localhost/api/workspaces/'+[...base,...action].join('/'),{method:'POST',headers:{'content-type':'application/json',...extraHeaders},...(body===undefined?{}:{body})}),[...base,...action]);
  for(const body of ['{','null','[]','   ']){
   const response=await call(['runtime','open'],body);assert.equal(response.status,400);assert.equal((await response.json()).error.code,'INVALID_JSON');
  }
  const unknown=await call(['runtime','open'],'{"agentId":"bad"}');assert.equal(unknown.status,400);assert.equal((await unknown.json()).error.code,'INVALID_INPUT');assert.equal(f.inputs.length,0);
  const oversized=await call(['runtime','open'],'',{'content-length':'65537'});assert.equal(oversized.status,413);assert.equal(f.inputs.length,0);
  // A Request can expose a readable body even when it contains zero bytes.
  const request=new Request('http://localhost',{method:'POST',body:''});assert(request.body);
  for(const body of [undefined,'','{}']){
   const opened=await call(['runtime','open'],body);assert.equal(opened.status,200);
   const lease=(await opened.json()).data.leaseId;
   const interrupted=await call(['interrupt'],'');assert.equal(interrupted.status,200);
   f.service.close(s.id,lease);
  }
  const message=await call(['messages'],'');assert.equal(message.status,400);assert.equal((await message.json()).error.code,'INVALID_JSON');
 }finally{f.close();}
});

test('shared JSON reader only accepts empty content when explicitly enabled and enforces stream limit',async()=>{
 const request=body=>new Request('http://localhost',{method:'POST',body});
 await assert.rejects(jsonBody(request('')),e=>e.code==='INVALID_JSON');
 assert.deepEqual(await jsonBody(request(''),65536,true),{});
 await assert.rejects(jsonBody(request('x'.repeat(65537)),65536,true),e=>e.status===413);
 await assert.rejects(jsonBody(request(' '),65536,true),e=>e.code==='INVALID_JSON');
});
