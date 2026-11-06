require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');

test('live native snapshot compares JSON persistence semantics while rejecting actual memory or file divergence',async()=>{
 const pi=await import('@earendil-works/pi-coding-agent'),ai=await import('@earendil-works/pi-ai'),load=Module._load;
 Module._load=function(spec,...args){return spec==='@earendil-works/pi-coding-agent'?pi:spec==='@earendil-works/pi-ai'?ai:load.call(this,spec,...args);};
 let PiSessionRuntime,initializeSession;
 try{({PiSessionRuntime}=require('../src/infrastructure/pi/pi-session-runtime.server.ts'));({initializeSession}=require('../src/infrastructure/pi/initialize-session.server.ts'));}finally{Module._load=load;}
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'pi-native-snapshot-')));
 const modelRuntime=await pi.ModelRuntime.create({credentials:{async read(){},async list(){return []},async modify(){},async delete(){}},modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
 modelRuntime.registerProvider('fixture',{baseUrl:'http://localhost',apiKey:'fake',api:'openai-completions',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1000}]});
 const runtime=new PiSessionRuntime(async()=>({runtime:modelRuntime,model:modelRuntime.getModel('fixture','fixture')}));let handle;
 try{
  const manager=initializeSession('snapshot',root,root),nativeRef={kind:'pi',sessionId:manager.getSessionId(),sessionFile:manager.getSessionFile(),cwd:root};
  const input={session:{id:'snapshot',nativeRef,agentSnapshot:null,state:'idle'},workingDirectory:root,independentProjectTools:true,allowProjectRead:true,allowProjectWrite:true};
  handle=await runtime.restore(input);
  handle.manager.appendMessage({role:'user',content:'search',timestamp:Date.now()});
  const message={role:'toolResult',toolCallId:'call',toolName:'web_fetch',content:[{type:'text',text:'parameter error',optional:undefined}],details:{optional:undefined,nested:[undefined,{value:'原文',optional:undefined}]},isError:true,durationMs:0,timestamp:Date.now()};
  handle.manager.appendMessage(message);
  const before=fs.readFileSync(nativeRef.sessionFile);
  const tree=await runtime.readTree(input);assert(tree.entries.length>0);
  const evidence=runtime.operationEvidence(input);assert(evidence.entryIds.includes(handle.manager.getLeafId()));
  const cold=new PiSessionRuntime(async()=>({runtime:modelRuntime,model:modelRuntime.getModel('fixture','fixture')}));
  assert.deepEqual(JSON.parse(JSON.stringify(tree)),JSON.parse(JSON.stringify(await cold.readTree(input))));
  assert.deepEqual(fs.readFileSync(nativeRef.sessionFile),before);
  message.content[0].text='changed memory';
  await assert.rejects(runtime.readTree(input),e=>e.code==='REQUEST_UNKNOWN');
  assert.deepEqual(fs.readFileSync(nativeRef.sessionFile),before);
  message.content[0].text='parameter error';
  const external={type:'custom',id:'external',parentId:handle.manager.getLeafId(),timestamp:new Date().toISOString(),customType:'external',data:{text:'preserve'}};
  fs.appendFileSync(nativeRef.sessionFile,JSON.stringify(external)+'\n');const divergent=fs.readFileSync(nativeRef.sessionFile);
  await assert.rejects(runtime.readTree(input),e=>e.code==='REQUEST_UNKNOWN');assert.deepEqual(fs.readFileSync(nativeRef.sessionFile),divergent);
 }finally{if(handle)await runtime.close(handle);fs.rmSync(root,{recursive:true,force:true});}
});
