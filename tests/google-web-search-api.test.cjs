require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./workspace-fixture.cjs');
const {createWorkspaceApi}=require('../src/shared/protocol/workspace-api.server.ts');
const {createServerWebSearchScope,assertServerWebSearch}=require('../src/infrastructure/pi/server-web-search.ts');
const {DomainError}=require('../src/domain/errors.ts');
const tick=()=>new Promise(setImmediate);
function setup(api){
 const f=fixture(),handle=createWorkspaceApi(f.service),scopes=new Map(),calls=[];let protocol=api,fail=false;
 const original=f.runtime.send.bind(f.runtime);
 f.runtime.validateWebSearch=()=>assertServerWebSearch({api:protocol});
 f.runtime.send=async(h,text,emit,stream,references,write,webSearch)=>{
  let scope=scopes.get(h.id);
  if(!scope){const handlers={},value=createServerWebSearchScope();value.extension({on:(name,fn)=>{handlers[name]=fn;},appendEntry:(type,data)=>f.runtime.requestEntry(h,type,data)});scope={value,handlers};scopes.set(h.id,scope);}
  scope.value.begin(!!webSearch);
  try{
   const controller=new AbortController(),isGoogle=protocol.startsWith('google-');
   const payload=isGoogle?{model:'controlled',contents:[{role:'user',parts:[{text}]}],config:{temperature:0.2,thinkingConfig:{includeThoughts:true},toolConfig:{functionCallingConfig:{mode:'AUTO'}},abortSignal:controller.signal,tools:[{functionDeclarations:[{name:'read'}]}]}}:{model:'controlled',input:[],tools:[{type:'function',name:'read'}]};
   for(let round=0;round<2;round++){
    const outgoing=scope.handlers.before_provider_request({payload},{model:{api:protocol}})??payload;
    calls.push({outgoing,payload,signal:controller.signal});
    const second=scope.handlers.before_provider_request({payload:outgoing},{model:{api:protocol}})??outgoing;
    assert.deepEqual(second,outgoing);
   }
   const data=isGoogle?{responseId:'controlled',candidates:[{content:{parts:[{text:'Result'}]},groundingMetadata:{webSearchQueries:['query'],groundingChunks:[{web:{uri:'https://example.com',title:'Source'}}],groundingSupports:[{segment:{text:'Result'},groundingChunkIndices:[0]}],searchEntryPoint:{renderedContent:'<div>Suggestions</div>'}}}]}:{type:'response.output_item.done',item:{type:'web_search_call',status:'completed',action:{query:'query'}}};
   scope.handlers.provider_stream_event({api:protocol,provider:'controlled',model:'controlled',data});
   scope.handlers.provider_stream_event({api:protocol,provider:'controlled',model:'controlled',data:{candidates:[{content:{parts:[{text:'No grounding'}]}}]}});
   if(fail)throw new DomainError('PROVIDER_ERROR','Controlled upstream rejection',502,true);
   await original(h,text,emit);
  }finally{scope.value.end();}
 };
 async function call(w,s,lease,body,key){const response=await handle(new Request('http://localhost/api/workspaces/'+w.id+'/sessions/'+s.id+'/messages',{method:'POST',headers:{'content-type':'application/json','idempotency-key':key,'x-session-lease-id':lease},body:JSON.stringify(body)}),[w.id,'sessions',s.id,'messages']);return {status:response.status,body:await response.json()};}
 return {...f,calls,scopes,call,setFailure:value=>{fail=value;},setProtocol:value=>{protocol=value;},interrupt:async(w,s)=>handle(new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),[w.id,'sessions',s.id,'interrupt'])};
}
test('workspace message API dispatches OpenAI and both Google search protocols without changing coding tools or leaking across turns',async()=>{
 for(const api of ['openai-responses','google-generative-ai','google-vertex']){
  const f=setup(api);let lease,w,s;
  try{
   w=await f.service.save(null,{name:'Work',projects:[{rootPath:f.a}],defaultProjectIndex:0},'w');s=f.service.createSession(w.id,{},'s');lease=(await f.service.open(w.id,s.id)).leaseId;
   const accepted=await f.call(w,s,lease,{content:'Search',webSearch:true},'search');assert.equal(accepted.status,202);await tick();assert.equal(f.calls.length,2);
   for(const {outgoing,payload,signal} of f.calls){
    if(api==='openai-responses'){assert.deepEqual(outgoing.tools,[{type:'function',name:'read'},{type:'web_search'}]);assert.equal(payload.tools.length,1);}
    else{assert.equal(outgoing.config.tools.length,2);assert.deepEqual(outgoing.config.tools[1],{googleSearch:{}});assert.equal(outgoing.config.tools[0],payload.config.tools[0]);assert.equal(outgoing.config.abortSignal,signal);assert.equal(outgoing.config.thinkingConfig,payload.config.thinkingConfig);assert.equal(outgoing.config.toolConfig,payload.config.toolConfig);assert.equal(payload.config.tools.length,1);assert.equal(outgoing.contents,payload.contents);assert.equal(outgoing.tools,undefined);}
   }
   const evidence=f.persisted.get(s.id).filter(e=>e.type==='server_web_search');assert.equal(evidence.length,1);
   if(api.startsWith('google-')){assert.equal(evidence[0].data.api,api);assert.equal(evidence[0].data.data.candidates[0].groundingMetadata.searchEntryPoint.renderedContent,'<div>Suggestions</div>');assert.equal(evidence[0].data.provider,'controlled');}
   f.finish();await tick();const count=f.calls.length;assert.equal((await f.call(w,s,lease,{content:'Search',webSearch:true},'search')).status,202);assert.equal(f.calls.length,count);
   assert.equal((await f.call(w,s,lease,{content:'Search',webSearch:false},'search')).status,409);
   assert.equal((await f.call(w,s,lease,{content:'No search',webSearch:false},'plain')).status,202);await tick();const outgoing=f.calls.at(-1).outgoing;
   assert.equal((api.startsWith('google-')?outgoing.config.tools:outgoing.tools).length,1);assert.equal(f.persisted.get(s.id).filter(e=>e.type==='server_web_search').length,1);f.finish();await tick();
  }finally{if(lease)f.service.close(s.id,lease);f.close();}
 }
});
test('Google search scope is cleared after upstream failure and explicit interrupt APIs',async()=>{
 for(const api of ['google-generative-ai','google-vertex']){
  const f=setup(api);let lease,w,s;
  try{
   w=await f.service.save(null,{name:'Work',projects:[{rootPath:f.a}],defaultProjectIndex:0},'w');s=f.service.createSession(w.id,{},'s');lease=(await f.service.open(w.id,s.id)).leaseId;
   f.setFailure(true);assert.equal((await f.call(w,s,lease,{content:'Fail search',webSearch:true},'failed')).status,202);await tick();assert(f.persisted.get(s.id).some(e=>e.type==='workspace_request_result'&&e.data.outcome==='failed'));
   f.setFailure(false);assert.equal((await f.call(w,s,lease,{content:'Plain after failure'},'after-failure')).status,202);await tick();assert.equal(f.calls.at(-1).outgoing.config.tools.length,1);f.finish();await tick();
   assert.equal((await f.call(w,s,lease,{content:'Interrupt search',webSearch:true},'interrupt')).status,202);await tick();assert.equal((await f.interrupt(w,s)).status,200);
   assert.equal((await f.call(w,s,lease,{content:'Plain after interrupt'},'after-interrupt')).status,202);await tick();assert.equal(f.calls.at(-1).outgoing.config.tools.length,1);f.finish();await tick();
  }finally{if(lease)f.service.close(s.id,lease);f.close();}
 }
});
test('unsupported protocol is rejected by the message API before request journaling and inference',async()=>{
 const f=setup('openai-completions');let lease,w,s;
 try{
  w=await f.service.save(null,{name:'Work',projects:[{rootPath:f.a}],defaultProjectIndex:0},'w');s=f.service.createSession(w.id,{},'s');lease=(await f.service.open(w.id,s.id)).leaseId;
  for(const api of ['openai-completions','anthropic-messages','openai-codex-responses']){
   f.setProtocol(api);const result=await f.call(w,s,lease,{content:'Search',webSearch:true},'unsupported');assert.equal(result.status,422);assert.equal(result.body.error.code,'WEB_SEARCH_UNSUPPORTED');assert.equal(f.calls.length,0);assert.equal(f.persisted.get(s.id).length,0);
  }
 }finally{if(lease)f.service.close(s.id,lease);f.close();}
});
