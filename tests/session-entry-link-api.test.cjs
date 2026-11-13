require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {fixture}=require('./workspace-fixture.cjs');
const {createSessionExecutionService}=require('../src/application/session-execution-service.ts');
const {createWorkspaceService}=require('../src/application/workspace-service.ts');
const {createProjectRepository}=require('../src/infrastructure/database/project-repository.ts');
const {createSessionRepository}=require('../src/infrastructure/database/session-repository.ts');
const {workspaceDirectories}=require('../src/infrastructure/workspaces/directories.server.ts');
async function modules(){
 const pi=await import('@earendil-works/pi-coding-agent'),ai=await import('@earendil-works/pi-ai'),original=Module._load;
 Module._load=function(n,...args){return n==='@earendil-works/pi-coding-agent'?pi:n==='@earendil-works/pi-ai'?ai:original.call(this,n,...args);};
 try{return {pi,ai,...require('../src/infrastructure/pi/pi-session-runtime.server.ts'),...require('./support/initialize-pi-session.ts')};}finally{Module._load=original;}
}
for(const scope of ['project','workspace'])test(`${scope} SSE links streamed assistant messages and native write/edit results to the final history`,async()=>{
 const {pi,ai,PiSessionRuntime,initializeSession}=await modules(),f=fixture();
 const models=await pi.ModelRuntime.create({credentials:{async read(){},async list(){return []},async modify(){},async delete(){}},modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
 models.registerProvider('fake',{name:'fake',baseUrl:'http://localhost',apiKey:'fake',api:'openai-completions',models:[{id:'fake',name:'fake',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1000}]});
 const runtime=new PiSessionRuntime(async()=>({runtime:models,defaults:{provider:'fake',modelId:'fake'}}));
 let id,service,owner,lease,disconnect;
 try{
  const cwd=fs.realpathSync(f.a),manager=initializeSession('entry-link-'+scope,cwd,f.root),ref={kind:'pi',sessionId:manager.getSessionId(),sessionFile:manager.getSessionFile(),cwd};
  if(scope==='project'){
   const projects=createProjectRepository(f.db),sessions=createSessionRepository(f.db);
   const p=projects.create({name:'P',description:null,kind:'code',rootPath:cwd,status:'active'});
   const s=sessions.create({projectId:p.id,purpose:'',agentId:null,agentSnapshot:null,mcpIds:[],mcpSnapshots:[]});id=s.id;owner=p.id;sessions.setNativeRefIfAbsent(id,ref);
   service=createSessionExecutionService({sessions,projects,catalog:{},runtime});lease=await service.open(id,'open');
  }else{
   service=createWorkspaceService({repository:f.repository,directories:workspaceDirectories,runtime});
   const w=await service.save(null,{name:'W',projects:[{rootPath:cwd}],defaultProjectIndex:0},'w');owner=w.id;id=service.createSession(owner,{},'s').id;f.repository.bindNative(owner,id,ref);lease=await service.open(owner,id);
  }
  const events=[];let finish;
  const completed=new Promise(resolve=>{finish=resolve;});
  disconnect=service.events.subscribe(id,lease.leaseId,frame=>{if(frame.event==='message'){events.push(frame.data);if(['complete','error'].includes(frame.data.type))finish();}},()=>{});
  const h=runtime.getHandle(id);let step=0;
  h.session.agent.streamFunction=()=>{
   const i=step++,content=i===0?[{type:'text',text:'Creating file'},{type:'toolCall',id:'write-file',name:'write',arguments:{path:'result.txt',content:'before'}}]:i===1?[{type:'text',text:'Editing file'},{type:'toolCall',id:'edit-file',name:'edit',arguments:{path:'result.txt',oldText:'before',newText:'after'}}]:[{type:'text',text:'Finished'}];
   const message={role:'assistant',content,api:'openai-completions',provider:'fake',model:'fake',usage:{input:10,output:5,cacheRead:3,cacheWrite:2,totalTokens:20,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:i<2?'toolUse':'stop',timestamp:Date.now()};
   const stream=ai.createAssistantMessageEventStream();
   stream.push({type:'start',partial:{...message,content:[]}});
   stream.push({type:'text_delta',contentIndex:0,delta:content[0].text,partial:message});
   stream.push({type:'done',reason:message.stopReason,message});stream.end();return stream;
  };
  const metrics=[];
  if(scope==='project'){
   for await(const event of service.send(id,'create and edit result.txt','project_write')){assert.notEqual(event.type,'error');if(event.type==='run_metrics')metrics.push(event);}
  }else{await service.accept(owner,id,{content:'create and edit result.txt'},'message',lease.leaseId);await completed;}
  await new Promise(setImmediate);
  assert.equal(fs.readFileSync(path.join(cwd,'result.txt'),'utf8'),'after');
  assert(!events.some(e=>e.type==='error'));
  if(scope==='workspace')metrics.push(...events.filter(e=>e.type==='run_metrics').map(e=>e.payload));
  assert.equal(metrics.length,1,'tool loop emits one root-run summary');
  assert.equal(metrics[0].totalTokens,60);
  assert.equal(metrics[0].input,30);
  assert.equal(metrics[0].output,15);
  assert.equal(metrics[0].complete,true);
  const tree=await runtime.readTree(h.input),entries=new Map(tree.entries.map(({entry})=>[entry.id,entry]));
  const starts=events.filter(e=>e.type==='message_start'&&['assistant','toolResult'].includes(e.payload.message.role));
  assert.equal(starts.filter(e=>e.payload.message.role==='assistant').length,3);
  assert.equal(starts.filter(e=>e.payload.message.role==='toolResult').length,2);
  for(const start of starts){
   const links=events.filter(e=>e.type==='entry_link'&&e.temporaryId===start.temporaryId&&e.runId===start.runId);
   assert.equal(links.length,1,`Missing or duplicate link for ${start.payload.message.role} ${start.temporaryId}`);
   assert.equal(entries.get(links[0].entryId)?.message.role,start.payload.message.role);
  }
  const readMessages=()=>scope==='project'?service.messages(id):service.messages(owner,id);
  const nativeTotal=h.session.getSessionStats().tokens.total;
  assert.equal(nativeTotal,60);
  assert.deepEqual((await readMessages()).tokenUsage,{totalTokens:nativeTotal,complete:true});
  if(scope==='workspace')assert.deepEqual((await readMessages()).latestRunUsage,{totalTokens:60,complete:true},'native request boundaries include all three model calls');
  await runtime.close(h);
  assert.deepEqual((await readMessages()).tokenUsage,{totalTokens:nativeTotal,complete:true},'cold history uses the same total as Pi');
  if(scope==='workspace')assert.deepEqual((await readMessages()).latestRunUsage,{totalTokens:60,complete:true},'cold reads derive the latest root from native usage');
 }finally{
  disconnect?.();const h=runtime.getHandle(id);if(h)await runtime.close(h);f.close();
 }
});
