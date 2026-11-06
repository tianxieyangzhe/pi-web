require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {parseMessageReferences}=require('../src/domain/message-references.ts');
const repositoryModule=require.resolve('../src/infrastructure/database/project-repository.server.ts');
require.cache[repositoryModule]={id:repositoryModule,filename:repositoryModule,loaded:true,exports:{projectRepository:{get(){throw Error('Unexpected standalone project lookup');}}}};
const {resolveProjectReferenceAt}=require('../src/infrastructure/projects/project-files.server.ts');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('workspace API sends only scoped project locations alongside uploaded snapshots',async()=>{
 const {fixture}=require('./workspace-fixture.cjs'),f=fixture();
 const {createWorkspaceService}=require('../src/application/workspace-service.ts');
 const {workspaceDirectories}=require('../src/infrastructure/workspaces/directories.server.ts');
 const {createWorkspaceApi}=require('../src/shared/protocol/workspace-api.server.ts');
 let captured=[],resolutions=0;
 f.runtime.send=async(_handle,_text,_emit,_timing,references)=>{captured.push(references);};
 const service=createWorkspaceService({repository:f.repository,directories:workspaceDirectories,runtime:f.runtime,resolveReference(workspaceId,reference){
  resolutions++;const project=f.repository.get(workspaceId).projects.find(p=>p.id===reference.projectId);assert(project);return resolveProjectReferenceAt(project.rootPath,reference.path);
 }});
 const api=createWorkspaceApi(service);
 let session,lease;
 try{
  const w=await service.save(null,{name:'Workspace',projects:[{rootPath:f.a}],defaultProjectIndex:0},'w');
  const other=await service.save(null,{name:'Other',projects:[{rootPath:f.b}],defaultProjectIndex:0},'other');
  session=service.createSession(w.id,{},'s');lease=await service.open(w.id,session.id);
  fs.writeFileSync(path.join(f.a,'source.txt'),'DO_NOT_INLINE_PROJECT_BODY');fs.writeFileSync(path.join(f.a,'.env'),'secret');
  const call=async(references,key)=>api(new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json','idempotency-key':key,'x-session-lease-id':lease.leaseId},body:JSON.stringify({content:'分析文件',references})}),[w.id,'sessions',session.id,'messages']);
  let response=await call([{projectId:w.projects[0].id,path:'source.txt'},{name:'upload.txt',data:Buffer.from('UPLOAD_SNAPSHOT').toString('base64')}],'first');assert.equal(response.status,202);await tick();
  assert.equal(captured.length,1);const material=JSON.stringify(captured[0]);assert.match(material,/source.txt/);assert.match(material,/absolutePath/);assert.equal(captured[0][1].type,'file');assert.equal(Buffer.from(captured[0][1].data,'base64').toString(),'UPLOAD_SNAPSHOT');assert.doesNotMatch(material,/DO_NOT_INLINE_PROJECT_BODY/);
  const before=resolutions;response=await call([{projectId:other.projects[0].id,path:'source.txt'}],'foreign');assert.equal(response.status,403);assert.equal(resolutions,before);assert.equal(captured.length,1);
  response=await call([{projectId:w.projects[0].id,path:'.env'}],'sensitive');assert.equal(response.status,403);assert.equal(captured.length,1);
 }finally{if(session&&lease)service.close(session.id,lease.leaseId);f.close();}
});

test('real Pi read tool reads current content after location selection without preloading the file',async()=>{
 const cwd=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'project-location-pi-'))),target=path.join(cwd,'document.txt');let session;
 const {DefaultResourceLoader,createAgentSession,SessionManager,SettingsManager,ModelRuntime}=await import('@earendil-works/pi-coding-agent');
 const {createAssistantMessageEventStream}=await import('@earendil-works/pi-ai');
 const {appendMessageReferences}=require('../src/infrastructure/pi/message-references.server.ts');
 try{
  fs.writeFileSync(target,'ORIGINAL_BODY_NOT_IN_CONTEXT');
  const refs=parseMessageReferences([{projectId:'p',path:'document.txt'}],new Set(['p']),ref=>resolveProjectReferenceAt(cwd,ref.path));
  assert.doesNotMatch(JSON.stringify(refs),/ORIGINAL_BODY_NOT_IN_CONTEXT/);
  fs.writeFileSync(target,'LATEST_CONTENT_FROM_READ_TOOL');
  const credentials={async read(){},async list(){return []},async modify(){},async delete(){}};
  const runtime=await ModelRuntime.create({credentials,modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
  runtime.registerProvider('fake',{name:'fake',baseUrl:'http://localhost',apiKey:'fake',api:'openai-completions',models:[{id:'fake',name:'fake',api:'openai-completions',baseUrl:'http://localhost',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1000}]});
  const loader=new DefaultResourceLoader({cwd,agentDir:cwd,noExtensions:true,noSkills:true,noContextFiles:true,noPromptTemplates:true,noThemes:true});await loader.reload();
  ({session}=await createAgentSession({cwd,modelRuntime:runtime,model:runtime.getModel('fake','fake'),resourceLoader:loader,sessionManager:SessionManager.inMemory(cwd),settingsManager:SettingsManager.inMemory({compaction:{enabled:false}}),tools:['read']}));
  const calls=[];
  session.agent.streamFunction=(_model,context)=>{
   calls.push(JSON.stringify(context.messages));const first=calls.length===1;
   const message={role:'assistant',content:first?[{type:'toolCall',id:'read-current',name:'read',arguments:{path:target}}]:[{type:'text',text:'done'}],api:'openai-completions',provider:'fake',model:'fake',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:first?'toolUse':'stop',timestamp:Date.now()};
   const stream=createAssistantMessageEventStream();stream.push({type:'done',reason:message.stopReason,message});stream.end();return stream;
  };
  const attachmentStore=path.join(cwd,'attachment-store');
  await appendMessageReferences(session,refs,'selection',attachmentStore);assert.equal(fs.existsSync(attachmentStore),false,'server file references must not create an attachment copy');
  await session.prompt('请读取参考文件',{expandPromptTemplates:false});await session.waitForIdle();
  assert.equal(calls.length,2);assert.match(calls[0],/document.txt/);assert.doesNotMatch(calls[0],/ORIGINAL_BODY_NOT_IN_CONTEXT|LATEST_CONTENT_FROM_READ_TOOL/);
  assert.match(calls[1],/LATEST_CONTENT_FROM_READ_TOOL/);assert.doesNotMatch(calls[1],/ORIGINAL_BODY_NOT_IN_CONTEXT/);
  assert(session.messages.some(message=>message.role==='toolResult'&&message.toolName==='read'));
 }finally{session?.dispose();fs.rmSync(cwd,{recursive:true,force:true});}
});
