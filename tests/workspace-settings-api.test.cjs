const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./workspace-fixture.cjs');
const {workspaceApi}=require('../web/api/workspace-client.ts');
const {createWorkspaceApi}=require('../src/shared/protocol/workspace-api.server.ts');

test('settings save projects read from DTO using only writable fields and preserves identities through HTTP',async()=>{
 const f=fixture(),originalFetch=global.fetch,requests=[];
 try{
  const handler=createWorkspaceApi(f.service);
  global.fetch=async(url,init)=>{
   const request=new Request('http://localhost'+url,init);
   requests.push({method:request.method,body:await request.clone().json(),etag:request.headers.get('if-match')});
   const segments=new URL(request.url).pathname.split('/').slice(3).filter(Boolean).map(decodeURIComponent);
   return handler(request,segments);
  };
  const created=await workspaceApi.save(null,{name:'Before',projects:[{rootPath:f.a},{rootPath:f.b}],defaultProjectIndex:0},undefined,'create');
  // Use the complete read DTO, including read-only project fields, as settings source.
  const updated=await workspaceApi.save(created.id,{...created,name:'After',defaultProjectIndex:1},created.writeETag,'update');
  const sent=requests.at(-1);
  assert.equal(sent.method,'PUT');assert.equal(sent.etag,created.writeETag);
  assert.deepEqual(Object.keys(sent.body).sort(),['defaultProjectIndex','name','projects']);
  assert.deepEqual(sent.body.projects,created.projects.map(({id,rootPath})=>({id,rootPath})));
  assert.equal(updated.name,'After');assert.equal(updated.defaultProjectId,created.projects[1].id);
  assert.deepEqual(updated.projects.map(p=>p.id),created.projects.map(p=>p.id));
  // Keep server validation strict for malformed direct callers.
  const invalid=await handler(new Request('http://localhost/api/workspaces/'+created.id,{method:'PUT',headers:{'content-type':'application/json','if-match':updated.writeETag},body:JSON.stringify({name:'Bad',projects:updated.projects,defaultProjectIndex:0})}),[created.id]);
  assert.equal(invalid.status,400);assert.equal((await invalid.json()).error.code,'INVALID_INPUT');
  assert.equal(f.repository.get(created.id).name,'After');
 }finally{global.fetch=originalFetch;f.close();}
});
