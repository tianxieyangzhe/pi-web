require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {isLocalFileLink,resolveFileLink}=require('../web/workspace/conversation/file-link.ts');
const {fixture}=require('./workspace-fixture.cjs');
test('local source links select longest project root and line, relative links use default project',()=>{
 const projects=[{id:'knowledge',rootPath:'/repo/knowledge'},{id:'lca',rootPath:'/repo/lca'},{id:'nested',rootPath:'/repo/lca/sub'}];
 assert.deepEqual(resolveFileLink('/repo/lca/src/insa.go#L84',projects,'knowledge'),{projectId:'lca',path:'src/insa.go',line:84});
 assert.deepEqual(resolveFileLink('/repo/lca/sub/a.go#L2-L4',projects,'knowledge'),{projectId:'nested',path:'a.go',line:2});
 assert.deepEqual(resolveFileLink('src/a%20b.go:12',projects,'lca'),{projectId:'lca',path:'src/a b.go',line:12});
 for(const href of ['/repo/lca-other/a.go','../../etc/passwd','%FF'])assert.throws(()=>resolveFileLink(href,projects,'lca'));
 for(const href of ['https://example.com/a','mailto:a@b.com','#L84','//example.com'])assert.equal(isLocalFileLink(href),false);
 for(const href of ['/repo/lca/a.go#L84','./a.go','a.go:84'])assert.equal(isLocalFileLink(href),true);
});
test('workspace file API reads selected project, checks scope, traversal, symlinks, type and capacity',async()=>{
 const f=fixture();try{
  const {createWorkspaceApi}=require('../src/shared/protocol/workspace-api.server.ts');
  const w=await f.service.save(null,{name:'Work',projects:[{rootPath:f.a},{rootPath:f.b}],defaultProjectIndex:0},'w'),p=w.projects[1];
  fs.writeFileSync(path.join(f.b,'insa.go'),'func main() {}');fs.writeFileSync(path.join(f.root,'outside'),'outside');fs.symlinkSync(path.join(f.root,'outside'),path.join(f.b,'escape'));
  fs.writeFileSync(path.join(f.b,'binary'),Buffer.from([0,1]));fs.writeFileSync(path.join(f.b,'large'),'x'.repeat(512*1024+1));
  const handle=createWorkspaceApi(f.service);
  async function call(owner,id,relative){const response=await handle(new Request('http://localhost/api/workspaces/'+owner+'/projects/'+id+'/files/content?path='+encodeURIComponent(relative)),[owner,'projects',id,'files','content']);return {status:response.status,body:await response.json()};}
  const result=await call(w.id,p.id,'insa.go');assert.equal(result.status,200);assert.deepEqual(result.body.data,{path:'insa.go',content:'func main() {}',size:14});
  assert.equal((await call('wrong',p.id,'insa.go')).status,404);assert.equal((await call(w.id,'wrong','insa.go')).status,404);
  for(const relative of ['../outside','escape',path.join(f.b,'insa.go')])assert.equal((await call(w.id,p.id,relative)).status,403);
  assert.equal((await call(w.id,p.id,'missing')).status,404);assert.equal((await call(w.id,p.id,'')).status,400);
  assert.equal((await call(w.id,p.id,'binary')).status,415);assert.equal((await call(w.id,p.id,'large')).status,413);
 }finally{f.close();}
});
