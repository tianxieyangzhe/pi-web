require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createServerWebSearchScope,assertServerWebSearch}=require('../src/infrastructure/pi/server-web-search.ts');
function scope(){const handlers={},entries=[],value=createServerWebSearchScope();value.extension({on:(name,fn)=>handlers[name]=fn,appendEntry:(type,data)=>entries.push({type,data})});return {...value,handlers,entries};}
test('server search preserves coding tools, is opt-in per turn, isolated, and retains original search/citation evidence',()=>{
 const a=scope(),b=scope(),ctx={model:{api:'openai-responses'}},payload={model:'test',tools:[{type:'function',name:'read'}],input:[]};
 const request=()=>a.handlers.before_provider_request({payload},ctx);
 assert.equal(request(),undefined);a.begin(true);
 assert.deepEqual(request(),{...payload,tools:[...payload.tools,{type:'web_search'}]});assert.equal(payload.tools.length,1);
 const result=request();assert.equal(a.handlers.before_provider_request({payload:result},ctx).tools.length,2);
 assert.equal(b.handlers.before_provider_request({payload},ctx),undefined);
 for(const item of [{id:'search-1',type:'web_search_call',status:'completed',action:{type:'search',query:'news'}},{type:'message',content:[{type:'output_text',text:'News',annotations:[{type:'url_citation',url:'https://example.com',title:'Source'}]}]}]){
  const data={type:'response.output_item.done',item};a.handlers.provider_stream_event({api:'openai-responses',data});assert.deepEqual(a.entries.at(-1),{type:'server_web_search',data});
 }
 a.handlers.provider_stream_event({api:'openai-responses',data:{type:'response.output_item.done',item:{type:'message',content:[{text:'no search'}]}}});assert.equal(a.entries.length,2);
 a.end();assert.equal(request(),undefined);a.handlers.provider_stream_event({api:'openai-responses',data:{type:'response.output_item.done',item:{type:'web_search_call'}}});assert.equal(a.entries.length,2);
 for(const api of ['openai-completions','openai-codex-responses','anthropic-messages'])assert.throws(()=>assertServerWebSearch({api}),e=>e.code==='WEB_SEARCH_UNSUPPORTED');
 a.begin(true);assert.throws(()=>a.handlers.before_provider_request({payload},{model:{api:'openai-completions'}}),e=>e.code==='WEB_SEARCH_UNSUPPORTED');a.end();
});

test('actual Pi runtime injects search across the tool loop, persists evidence, and clears it after success and failure',async()=>{
 const pi=await import('@earendil-works/pi-coding-agent'),ai=await import('@earendil-works/pi-ai'),Module=require('node:module'),load=Module._load;
 Module._load=function(spec,...args){return spec==='@earendil-works/pi-coding-agent'?pi:spec==='@earendil-works/pi-ai'?ai:load.call(this,spec,...args);};
 let PiSessionRuntime,initializeSession;try{({PiSessionRuntime}=require('../src/infrastructure/pi/pi-session-runtime.server.ts'));({initializeSession}=require('./support/initialize-pi-session.ts'));}finally{Module._load=load;}
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'server-search-')));
 const credentials={async read(){},async list(){return []},async modify(){},async delete(){}};
 const modelRuntime=await pi.ModelRuntime.create({credentials,modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
 modelRuntime.registerProvider('test',{baseUrl:'http://localhost',apiKey:'fake',api:'openai-responses',models:[{id:'test',name:'test',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1000}]});
 const runtime=new PiSessionRuntime(async()=>({runtime:modelRuntime,model:modelRuntime.getModel('test','test')})),manager=initializeSession('search-fixture',root,root);
 const nativeRef={kind:'pi',sessionId:manager.getSessionId(),sessionFile:manager.getSessionFile(),cwd:root};
 const input={session:{id:'search',nativeRef,agentSnapshot:null,state:'idle'},workingDirectory:root,workspace:{id:'w',defaultProjectId:'p',projects:[],prompt:'test'}};
 let handle;try{
  handle=await runtime.restore(input);const payloads=[];let tool=true,fail=false;
  handle.session.agent.streamFunction=(model,context,options)=>{
   const stream=ai.createAssistantMessageEventStream();(async()=>{try{
    payloads.push(await options.onPayload({model:'test',tools:[{type:'function',name:'read'}]},model));
    if(fail)throw Error('simulated failure');
    await options.onProviderStreamEvent({type:'response.output_item.done',item:{id:'search',type:'web_search_call',status:'completed',action:{query:'news'}}},model);
    const call=tool;tool=false;const message={role:'assistant',content:call?[{type:'toolCall',id:'read-1',name:'read',arguments:{path:__filename}}]:[{type:'text',text:'done'}],api:'openai-responses',provider:'test',model:'test',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:call?'toolUse':'stop',timestamp:Date.now()};stream.push({type:'done',reason:message.stopReason,message});stream.end();
   }catch(error){stream.push({type:'error',reason:'error',error:{role:'assistant',content:[],api:'openai-responses',provider:'test',model:'test',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'error',errorMessage:error.message,timestamp:Date.now()}});stream.end();}})();return stream;
  };
  await runtime.send(handle,'search and read',()=>{},undefined,undefined,true,true);assert.equal(payloads.length,2);assert(payloads.every(p=>p.tools.some(t=>t.type==='web_search')));
  assert(handle.manager.getEntries().some(e=>e.type==='custom'&&e.customType==='server_web_search'));
  assert(pi.SessionManager.open(nativeRef.sessionFile).getEntries().some(e=>e.customType==='server_web_search'));
  await runtime.send(handle,'no search',()=>{});assert(!payloads.at(-1).tools.some(t=>t.type==='web_search'));
  fail=true;await assert.rejects(runtime.send(handle,'failure',()=>{},undefined,undefined,true,true));assert(payloads.at(-1).tools.some(t=>t.type==='web_search'));
  fail=false;await runtime.send(handle,'after failure',()=>{});assert(!payloads.at(-1).tools.some(t=>t.type==='web_search'));
 }finally{if(handle)await runtime.close(handle);fs.rmSync(root,{recursive:true,force:true});}
});
