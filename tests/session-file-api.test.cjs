require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
const {createHash}=require('node:crypto'),{zipSync,strToU8}=require('fflate');
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'session-file-api-')));
const nativeId='native-current',otherId='native-other';
const scope=path.join(root,'.data/session-files',createHash('sha256').update(nativeId).digest('hex'));
const other=path.join(root,'.data/session-files',createHash('sha256').update(otherId).digest('hex'));
fs.mkdirSync(path.join(scope,'material'),{recursive:true});fs.mkdirSync(other,{recursive:true});
const name='0024oceanbase数据库适配.docx',file=path.join(scope,'material',name);
const bytes=Buffer.from(zipSync({'word/document.xml':strToU8('<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>会话文档内容</w:t></w:r></w:p></w:body></w:document>')}));
fs.writeFileSync(file,bytes);fs.writeFileSync(path.join(other,'secret.txt'),'other session');fs.symlinkSync(path.join(other,'secret.txt'),path.join(scope,'escape'));fs.writeFileSync(path.join(scope,'.env'),'secret');
const session={id:'s',projectId:'p',workspaceId:'w',nativeRef:{sessionId:nativeId}};
const load=Module._load;
Module._load=function(spec,...args){
 if(spec==='@/infrastructure/application-config-root')return {applicationConfigRoot:root};
 if(spec==='@/infrastructure/database/session-repository.server')return {sessionRepository:{get:id=>id==='s'?session:null}};
 if(spec==='@/infrastructure/database/project-repository.server')return {projectRepository:{get:()=>null}};
 return load.call(this,spec,...args);
};
let preview,download,readSessionFile;
try{preview=require('../src/app/api/projects/[projectId]/sessions/[sessionId]/files/content/route.ts');download=require('../src/app/api/projects/[projectId]/sessions/[sessionId]/files/download/route.ts');({readSessionFile}=require('../src/infrastructure/references/session-file-reader.server.ts'));}finally{Module._load=load;}
const {createSessionFileService}=require('../src/application/session-file-service.ts');
const {createWorkspaceService}=require('../src/application/workspace-service.ts');
const {createWorkspaceApi}=require('../src/shared/protocol/workspace-api.server.ts');
const get=(owner,id)=>owner==='w'&&id==='s'?session:null;
const service=createWorkspaceService({repository:{session:get},runtime:{},directories:{},sessionFiles:createSessionFileService(get,readSessionFile)});
const workspace=createWorkspaceApi(service);
function callProject(action,p,owner='p',sid='s'){return (action==='content'?preview:download).GET(new Request('http://localhost/?path='+encodeURIComponent(p)),{params:Promise.resolve({projectId:owner,sessionId:sid})});}
function callWorkspace(action,p,owner='w',sid='s'){return workspace(new Request('http://localhost/?path='+encodeURIComponent(p)),[owner,'sessions',sid,'files',action]);}
test('both Session APIs preview the exact absolute generated-file link outside the project then download using returned relative path',async()=>{
 for(const call of [callProject,callWorkspace]){
  const response=await call('content',file);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const data=(await response.json()).data;assert.equal(data.path,'material/'+name);assert.equal(data.format,'docx');assert.equal(data.blocks[0].text,'会话文档内容');assert.equal(JSON.stringify(data).includes(root),false);
  const result=await call('download',data.path);assert.equal(result.status,200);assert.match(result.headers.get('content-disposition'),/attachment/);assert.ok(result.headers.get('content-disposition').includes(encodeURIComponent(name)));assert.deepEqual(Buffer.from(await result.arrayBuffer()),bytes);
 }
 assert.deepEqual(fs.readFileSync(file),bytes);
});
test('both Session APIs reject other-session, arbitrary host paths, traversal, symlinks and sensitive files',async()=>{
 for(const call of [callProject,callWorkspace])for(const action of ['content','download'])for(const p of [path.join(other,'secret.txt'),'/etc/passwd','../secret','escape','.env']){
  const response=await call(action,p);assert.equal(response.status,403,p);assert.equal(response.headers.get('content-disposition'),null);assert.ok((await response.json()).error.code);
 }
});
test('both Session APIs enforce owner, session, required path and missing-file errors',async()=>{
 for(const call of [callProject,callWorkspace]){
  assert.equal((await call('content',file,'other')).status,404);assert.equal((await call('download',file,undefined,'other')).status,404);
  assert.equal((await call('content','')).status,400);assert.equal((await call('content','missing.docx')).status,404);
 }
});
test('session without native identity cannot read generated files',async()=>{
 const saved=session.nativeRef;try{session.nativeRef=null;for(const call of [callProject,callWorkspace])assert.equal((await call('content',file)).status,409);}finally{session.nativeRef=saved;}
});
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
