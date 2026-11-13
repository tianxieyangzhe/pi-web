require('./register.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./workspace-fixture.cjs');
const {createSessionExecutionService}=require('../src/application/session-execution-service.ts');
const {createWorkspaceService}=require('../src/application/workspace-service.ts');
const {createProjectRepository}=require('../src/infrastructure/database/project-repository.ts');
const {createSessionRepository}=require('../src/infrastructure/database/session-repository.ts');
const {workspaceDirectories}=require('../src/infrastructure/workspaces/directories.server.ts');
const {createWorkspaceApi}=require('../src/shared/protocol/workspace-api.server.ts');
const node=(id,parentId,message)=>({entry:{id,parentId,type:'message',message},label:null,labelTimestamp:null});
const call=(id,parentId,callId,file,tool='edit')=>node(id,parentId,{role:'assistant',content:[{type:'toolCall',id:callId,name:tool,arguments:{path:file}}]});
const diff=(id,parentId,callId,patch,extra={})=>node(id,parentId,{role:'toolResult',toolName:'edit',toolCallId:callId,details:{diff:patch,firstChangedLine:50},...extra});

for(const scope of ['project','workspace'])test(`${scope} changes API projects native edit evidence without filesystem snapshots`,async()=>{
 const f=fixture();let service,owner,id,records=[],entries=[],release;
 const operations={list:()=>records};
 const build=()=>scope==='project'?createSessionExecutionService({sessions,projects,catalog:{},runtime:f.runtime,operations}):createWorkspaceService({repository:f.repository,directories:workspaceDirectories,runtime:f.runtime});
 const projects=createProjectRepository(f.db),sessions=createSessionRepository(f.db);
 f.runtime.readTree=async()=>({entries,activeLeafId:entries.at(-1)?.entry.id??null});
 const read=selection=>scope==='project'?service.changes(id,selection):service.changes(owner,id,selection);
 const setRound=(key,before,after)=>{
  if(scope==='project')records=[{operationId:key,operation:'message',phase:after?'completed':'prepared',timestamp:'2026-01-01',sequence:1,evidence:{baseline:{entryIds:before},...(after?{after:{entryIds:after}}:{})}}];
  else{const journal=f.persisted.get(id);journal.length=0;journal.push({type:'workspace_request',data:{key,hash:'hash',entryIds:before}});if(after)journal.push({type:'workspace_request_result',data:{key,hash:'hash',outcome:'settled',entryIds:after}});}
 };
 try{
  if(scope==='project'){
   owner=projects.create({name:'P',description:null,kind:'code',rootPath:f.a,status:'active'}).id;
   id=sessions.create({projectId:owner,purpose:'',agentId:null,agentSnapshot:null,mcpIds:[],mcpSnapshots:[]}).id;
  }else{
   const setup=build();owner=(await setup.save(null,{name:'W',projects:[{rootPath:f.a},{rootPath:f.b}],defaultProjectIndex:0},'create')).id;id=setup.createSession(owner,{},'create').id;
  }
  service=build();const lease=scope==='project'?await service.open(id,'open'):await service.open(owner,id);
  assert.equal((await read()).status,'not_recorded');
  const cwd=f.inputs.at(-1).workingDirectory;
  const otherRoot=scope==='workspace'?f.repository.get(owner).projects[1].rootPath:cwd;
  const first=' 49 context\n-50 old\n+50 new\n 51 context',revert='-50 new\n+50 old';
  entries=[node('old',null,{role:'user'}),call('old-call','old','old-call-id','old.go'),diff('old-result','old-call','old-call-id','+ old diff'),node('root','old-result',{role:'user'}),call('a','root','edit-1',path.join(cwd,'src','insa.go')),diff('r1','a','edit-1',first),node('steer','r1',{role:'user'}),call('b','steer','edit-2','src/insa.go'),diff('r2','b','edit-2',revert),call('write-call','r2','write','new.go','write'),node('write-result','write-call',{role:'toolResult',toolName:'write',toolCallId:'write',content:[{type:'text',text:'wrote file'}]}),call('bash-call','write-result','bash','script.sh','bash'),node('bash-result','bash-call',{role:'toolResult',toolName:'bash',toolCallId:'bash',details:{diff:'+ not an edit'}}),call('fail-call','bash-result','failure','failed.go'),diff('fail-result','fail-call','failure','+ failed',{isError:true}),call('branch-a','root','duplicate',path.join(otherRoot,scope==='workspace'?'src/insa.go':'correct.go')),call('branch-b','root','duplicate','wrong.go'),diff('branch-result','branch-a','duplicate','+ correct branch')];
  const before=['old','old-call','old-result'];
  setRound('root-request',before,entries.map(item=>item.entry.id));
  if(scope==='workspace')f.persisted.get(id).push({type:'workspace_request',data:{key:'steer-request',hash:'steer',operation:'steer'}},{type:'workspace_request_result',data:{key:'steer-request',hash:'steer',operation:'steer',outcome:'queued'}});
  const result=await read();assert.equal(result.status,'recorded');assert.equal(result.runId,'root-request');assert.deepEqual(result.files,[{id:'r1',path:'src/insa.go',projectPath:cwd,editCount:2},{id:'branch-result',path:scope==='workspace'?'src/insa.go':'correct.go',projectPath:otherRoot,editCount:1}]);
  assert.deepEqual((await read({runId:result.runId,fileId:'branch-result'})).edits.map(edit=>edit.patch),['+ correct branch'],'same relative paths across projects remain independently selectable');
  assert.equal(new Set(result.files.map(file=>file.projectPath)).size,scope==='workspace'?2:1);
  if(scope==='project')records[0].phase='failed';else f.persisted.get(id).find(record=>record.type==='workspace_request_result'&&record.data.key==='root-request').data.outcome='aborted';
  assert.deepEqual(await read(),result,'failure or stop does not discard native edits');
  const content=await read({runId:result.runId,fileId:'r1'});assert.deepEqual(content,{runId:'root-request',fileId:'r1',edits:[{entryId:'r1',patch:first,firstChangedLine:50},{entryId:'r2',patch:revert,firstChangedLine:50}]});
  assert(!('before' in content));assert(!('after' in content));
  entries.push(call('outside','branch-result','later','outside.go'),diff('outside-result','outside','later','+ outside round'));
  assert.deepEqual(await read(),result,'after boundary excludes later entries');
  service=build();assert.deepEqual(await read(),result,'cold service reprojects native evidence');
  await f.runtime.close(f.runtime.getHandle(id));assert.deepEqual(await read(),result,'reading native history does not require a live runtime');
  // No project files exist: paths and diffs still come directly from native tool evidence.
  assert.equal(fs.existsSync(path.join(f.a,'src','insa.go')),false);assert.equal(fs.existsSync(path.join(f.root,'session-file-changes')),false);
  const moved=f.a+'-temporarily-unavailable';fs.renameSync(f.a,moved);try{assert.deepEqual(await read(),result,'projection never scans the project directory');}finally{fs.renameSync(moved,f.a);}
  if(scope==='workspace'){
   const api=createWorkspaceApi(service);
   let response=await api(new Request('http://local/api/changes'),[owner,'sessions',id,'changes']);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
   response=await api(new Request('http://local/api/changes?runId=root-request&fileId=r1'),[owner,'sessions',id,'changes','content']);assert.equal(response.status,200);assert.deepEqual((await response.json()).data,content);
   response=await api(new Request('http://local/api/changes?runId=root-request&runId=other&fileId=r1'),[owner,'sessions',id,'changes','content']);assert.equal(response.status,400);
   response=await api(new Request('http://local/api/changes'),['other','sessions',id,'changes']);assert.equal(response.status,404);
  }else await assert.rejects(()=>service.changes('other-session'),error=>error.code==='NOT_FOUND');
  await assert.rejects(()=>read({runId:result.runId,fileId:'missing'}),error=>error.code==='NOT_FOUND');
  setRound('next-root',entries.map(item=>item.entry.id));assert.equal((await read()).files.length,0);
  await assert.rejects(()=>read({runId:result.runId,fileId:'r1'}),error=>error.code==='CHANGE_RUN_REPLACED');
  setRound('missing-boundary',undefined);const unavailable=await read();assert.equal(unavailable.status,'boundary_unavailable');assert(unavailable.notice.includes('边界'));assert.deepEqual(unavailable.files,[]);
  setRound('bad-boundary',['missing-native-id']);assert.equal((await read()).status,'boundary_unavailable');
  setRound('live-root',entries.map(item=>item.entry.id),scope==='workspace'?entries.map(item=>item.entry.id):undefined);
  const start=new Promise(resolve=>{f.runtime.send=async()=>{resolve();await new Promise(done=>{release=done;});};});
  const reopened=scope==='project'?await service.open(id,'reopen'):await service.open(owner,id);
  let completed;const done=new Promise(resolve=>{completed=resolve;});
  if(scope==='project')service.accept(id,'live',undefined,completed);
  else {let restoring=true;const disconnect=service.events.subscribe(id,reopened.leaseId,frame=>{if(!restoring&&frame.event==='message'&&frame.data.type==='run_metrics'){disconnect();completed();}},()=>{});restoring=false;f.runtime.operationEvidence=()=>({entryIds:entries.map(item=>item.entry.id)});await service.accept(owner,id,{content:'live'},'live-root-actual',reopened.leaseId);}
  await start;entries.push(call('live-call','outside-result','live-edit','live.go'),diff('live-result','live-call','live-edit','+ live diff'));
  const live=await read();assert.equal(live.status,'running');assert.deepEqual(live.files,[{id:'live-result',path:'live.go',projectPath:cwd,editCount:1}]);release();await done;
  assert.equal((await read()).files[0].path,'live.go','completed native edits remain readable');
 }finally{release?.();if(service&&id)await service.deleteSession(owner,id);f.close();}
});
