require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
test('Project and Workspace use Pi default automatic compaction through send, native persistence, idle settlement, manual compact and cold restore',async()=>{
 const pi=await import('@earendil-works/pi-coding-agent'),ai=await import('@earendil-works/pi-ai'),load=Module._load;
 Module._load=function(spec,...args){return spec==='@earendil-works/pi-coding-agent'?pi:spec==='@earendil-works/pi-ai'?ai:load.call(this,spec,...args);};
 let PiSessionRuntime,initializeSession;try{({PiSessionRuntime}=require('../src/infrastructure/pi/pi-session-runtime.server.ts'));({initializeSession}=require('../src/infrastructure/pi/initialize-session.server.ts'));}finally{Module._load=load;}
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'pi-auto-compaction-')));
 const registry=await pi.ModelRuntime.create({credentials:{async read(){},async list(){return []},async modify(){},async delete(){}},modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
 registry.registerProvider('fixture',{baseUrl:'http://localhost',apiKey:'fake',api:'openai-completions',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1000}]});
 const runtime=new PiSessionRuntime(async()=>({runtime:registry,model:registry.getModel('fixture','fixture')})),defaults=pi.SettingsManager.inMemory().getCompactionSettings();assert.equal(defaults.enabled,true);
 try{for(const workspace of [false,true]){
  const manager=initializeSession('auto-'+workspace,root,root);
  for(let i=0;i<12;i++)manager.appendMessage({role:'user',content:`history ${i} `+'long original history '.repeat(3000),timestamp:Date.now()});
  const nativeRef={kind:'pi',sessionId:manager.getSessionId(),sessionFile:manager.getSessionFile(),cwd:root};
  const input={session:{id:'auto-'+workspace,nativeRef,agentSnapshot:null,state:'idle'},workingDirectory:root,independentProjectTools:true,allowProjectRead:true,allowProjectWrite:true,...(workspace?{workspace:{id:'w',defaultProjectId:'p',projects:[],prompt:'test'}}:{})};
  let handle=await runtime.restore(input);try{
   assert.deepEqual(handle.session.settingsManager.getCompactionSettings(),defaults);assert.equal((await runtime.inspect(input)).autoCompactionEnabled,true);assert.equal(runtime.getHandle(input.session.id,input),handle);
   let calls=0;const events=[];
   handle.session.subscribe(event=>events.push({type:event.type,reason:event.reason,idle:handle.session.isIdle}));
   handle.session.agent.streamFunction=()=>{
    const high=calls++===0,tokens=high?120000:1,stream=ai.createAssistantMessageEventStream(),message={role:'assistant',content:[{type:'text',text:high?'answer':'controlled native summary'}],api:'openai-completions',provider:'fixture',model:'fixture',usage:{input:tokens,output:1,cacheRead:0,cacheWrite:0,totalTokens:tokens+1,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()};
    stream.push({type:'done',reason:'stop',message});stream.end();return stream;
   };
   await runtime.send(handle,'continue',()=>{});
   assert(calls>=2,'Pi invokes the same controlled model stream for automatic summarization');assert(events.some(e=>e.type==='compaction_start'&&e.reason==='threshold'));assert(events.some(e=>e.type==='compaction_end'));
   assert(events.findLastIndex(e=>e.type==='agent_settled')>events.findIndex(e=>e.type==='compaction_end'));assert.equal(handle.session.isIdle,true);
   const records=handle.manager.getEntries().filter(e=>e.type==='compaction');assert(records.length);assert.match(records.at(-1).summary,/controlled native summary/);
   assert(pi.SessionManager.open(nativeRef.sessionFile).getEntries().some(e=>e.id===records.at(-1).id));assert.equal(handle.session.autoCompactionEnabled,true);assert.deepEqual(handle.session.settingsManager.getCompactionSettings(),defaults);
   // A manual invocation may have nothing left to compact; either outcome keeps automatic compaction enabled.
   try{await runtime.compact(handle);}catch(error){assert.equal(error.code,'NOTHING_TO_COMPACT');}
   assert.equal(handle.session.autoCompactionEnabled,true);
   await runtime.close(handle);handle=await runtime.restore(input);assert.equal(handle.manager.getSessionId(),nativeRef.sessionId);assert.deepEqual(handle.session.settingsManager.getCompactionSettings(),defaults);assert.equal((await runtime.inspect(input)).autoCompactionEnabled,true);
  }finally{await runtime.close(handle);}
 }}finally{fs.rmSync(root,{recursive:true,force:true});}
});
