require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {appendWorkspaceRequest,readWorkspaceRequests}=require('../src/infrastructure/workspaces/request-journal.server.ts');
const {unresolvedRequests}=require('../src/application/workspace-service.ts');

test('request journal persists preparation and settlement outside Pi transcript and recovers unknown requests',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-journal-'));try{
  const identity={workspaceId:'w',sessionId:'s',nativeSessionId:'pi',sessionFile:path.join(root,'native.jsonl')};fs.writeFileSync(identity.sessionFile,'native content');
  assert.deepEqual(readWorkspaceRequests(identity),[]);
  appendWorkspaceRequest(identity,'workspace_request',{key:'k',hash:'h'});assert.equal(unresolvedRequests(readWorkspaceRequests(identity)).length,1);
  appendWorkspaceRequest(identity,'workspace_request_result',{key:'k',hash:'h',outcome:'settled'});assert.deepEqual(unresolvedRequests(readWorkspaceRequests(identity)),[]);
  assert.equal(fs.readFileSync(identity.sessionFile,'utf8'),'native content');
  assert.equal(fs.statSync(identity.sessionFile+'.workspace-requests.jsonl').mode&0o777,0o600);
  const before=fs.readFileSync(identity.sessionFile+'.workspace-requests.jsonl','utf8');
  for(const other of [{...identity,workspaceId:'other'},{...identity,sessionId:'other'},{...identity,nativeSessionId:'other'}]){
   assert.throws(()=>readWorkspaceRequests(other),e=>e.code==='REQUEST_UNKNOWN');assert.throws(()=>appendWorkspaceRequest(other,'workspace_request',{key:'k2',hash:'h2'}),e=>e.code==='REQUEST_UNKNOWN');
  }
  assert.equal(fs.readFileSync(identity.sessionFile+'.workspace-requests.jsonl','utf8'),before);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('partial or corrupt journal refuses append without truncating evidence',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-journal-corrupt-'));try{
  const identity={workspaceId:'w',sessionId:'s',nativeSessionId:'pi',sessionFile:path.join(root,'native.jsonl')},file=identity.sessionFile+'.workspace-requests.jsonl';
  for(const content of ['', '{partial', '{}\n', '\n']){
   fs.writeFileSync(file,content);assert.throws(()=>readWorkspaceRequests(identity),e=>e.code==='REQUEST_UNKNOWN');assert.throws(()=>appendWorkspaceRequest(identity,'workspace_request',{key:'k',hash:'h'}),e=>e.code==='REQUEST_UNKNOWN');assert.equal(fs.readFileSync(file,'utf8'),content);
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
