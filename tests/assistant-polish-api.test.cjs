require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
const {fixture}=require('./workspace-fixture.cjs');
const {DomainError}=require('../src/domain/errors.ts');
const {createAgentPreparationService}=require('../src/application/agent-service.ts');
const {createUnifiedAssistantService}=require('../src/application/unified-assistant-service.ts');
const {createAgentPreparationApi}=require('../src/shared/protocol/agent-preparation-api.server.ts');
const {createGenerationSkills}=require('../src/infrastructure/agents/generation-skills.server.ts');
const definition=(source=null)=>({format:4,scope:source?.kind??'global',source,systemPromptMode:'inherit',systemPrompt:''});
async function setup(){
 const f=fixture(),pi=await import('@earendil-works/pi-coding-agent'),ai=await import('@earendil-works/pi-ai'),original=Module._load;let createAgentGenerator;
 Module._load=function(name,...args){return name==='@earendil-works/pi-coding-agent'?pi:name==='@earendil-works/pi-ai'?ai:original.call(this,name,...args);};
 try{({createAgentGenerator}=require('../src/infrastructure/pi/agent-generation.server.ts'));}finally{Module._load=original;}
 const runtime=await pi.ModelRuntime.create({credentials:{async read(){},async list(){return [];},async modify(){},async delete(){}},modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
 runtime.registerProvider('controlled',{api:'openai-completions',apiKey:'fake',baseUrl:'http://localhost',models:[{id:'controlled',name:'controlled',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1000}]});
 const state={mode:'success',reason:'',answer:JSON.stringify({name:'Polished',text:'完整润色结果',warnings:[]}),inputs:[],created:0,disposed:0,scopes:[]};
 const generate=createAgentGenerator(async()=>{if(state.mode==='configure-throw')throw Error(state.reason);return {runtime,model:runtime.getModel('controlled','controlled')};},async options=>{
  assert.deepEqual(options.tools,[],'assistant polishing must not load project tools');
  const result=await pi.createAgentSession(options);state.created++;const dispose=result.session.dispose.bind(result.session);result.session.dispose=()=>{state.disposed++;dispose();};
  if(state.mode==='prompt-throw')result.session.prompt=async()=>{throw Error(state.reason);};
  else if(state.mode==='domain-throw')result.session.prompt=async()=>{throw new DomainError('MODEL_UNAVAILABLE',state.reason,409,true);};
  else if(state.mode==='missing')result.session.prompt=async()=>{};
  else result.session.agent.streamFunction=(model,context)=>{
   const user=context.messages.filter(m=>m.role==='user').at(-1),text=typeof user.content==='string'?user.content:user.content.filter(p=>p.type==='text').map(p=>p.text).join('');state.inputs.push(JSON.parse(text));
   const failed=state.mode==='provider-error',stream=ai.createAssistantMessageEventStream(),message={role:'assistant',content:failed?[]:[{type:'text',text:state.mode==='empty'?'':state.mode==='blank-content'?state.reason:state.answer}],api:model.api,provider:model.provider,model:model.id,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:failed?'error':'stop',errorMessage:failed?state.reason:undefined,timestamp:Date.now()};
   stream.push(failed?{type:'error',reason:'error',error:message}:{type:'done',reason:'stop',message});stream.end();return stream;
  };
  return result;
 });
 const legacy=createAgentPreparationService({skills:createGenerationSkills(),resolveSource:()=>{throw Error('polishing must not collect project materials');},generate});
 const service=createUnifiedAssistantService(legacy,source=>state.scopes.push(source)),route=createAgentPreparationApi(service);
 const call=(body,stream=false,signal)=>route(new Request('http://localhost/api/agents/prepare',{method:'POST',headers:{'content-type':'application/json',...(stream?{accept:'application/x-ndjson'}:{})},body:JSON.stringify(body),signal}));
 return {f,state,call,route,close:()=>f.close()};
}
test('unified polish API accepts full pasted text without uploads and preserves scope and the original draft',async()=>{
 const f=await setup();
 try{
  const pasted='  # 助手要求\r\n\r\n'+('保留这个职责与表达要求\n'.repeat(700))+'\r\n尾部空白  ';
  for(const source of [null,{kind:'project',projectId:'p'},{kind:'workspace',workspaceId:'w',projectIds:null}]){
   for(const stream of [false,true]){
    const currentDraft=definition(source),before=structuredClone(currentDraft),response=await f.call({mode:'generate',currentDraft,inputText:pasted},stream);assert.equal(response.status,200);
    const data=stream?(await response.text()).trim().split('\n').map(JSON.parse).find(e=>e.type==='result').data:(await response.json()).data;
    assert.deepEqual(data.definition,{...before,systemPromptMode:'replace',systemPrompt:'完整润色结果'});assert.deepEqual(currentDraft,before);
    assert.equal(f.state.inputs.at(-1).inputText,pasted);assert.equal(f.state.inputs.at(-1).skill,null);assert.deepEqual(f.state.inputs.at(-1).projects,[]);
   }
  }
  const currentDraft={...definition(),systemPromptMode:'replace',systemPrompt:'原始正文\r\n'},before=structuredClone(currentDraft);f.state.answer=JSON.stringify({changes:{systemPrompt:'完整修改结果'},warnings:[]});
  const response=await f.call({mode:'revise',currentDraft,feedback:'  保留原意，调整表达\n'});assert.equal(response.status,200);assert.equal((await response.json()).data.definition.systemPrompt,'完整修改结果');assert.equal(f.state.inputs.at(-1).feedback,'  保留原意，调整表达\n');assert.deepEqual(currentDraft,before);
  assert.equal(f.state.created,f.state.disposed);
 }finally{f.close();}
});
test('unified polish API and its streaming client preserve raw provider and SDK errors without truncation or rewriting',async()=>{
 const f=await setup(),previous=global.fetch;
 try{
  const reason='  controlled API error (404):\n{\n  "message": "no route available for the requested model",\n  "detail": "'+('原因详情'.repeat(350))+'"\n}\n  ';
  const currentDraft=definition({kind:'workspace',workspaceId:'w',projectIds:['p']}),before=structuredClone(currentDraft),body={mode:'generate',currentDraft,inputText:'直接粘贴内容'};
  for(const mode of ['provider-error','prompt-throw','configure-throw','domain-throw']){
   f.state.mode=mode;f.state.reason=reason;
   for(const stream of [false,true]){
    const response=await f.call(body,stream),envelope=stream?(await response.text()).trim().split('\n').map(JSON.parse).at(-1):await response.json();
    assert.equal(response.status,stream?200:mode==='domain-throw'?409:503);assert.equal(envelope.error.message,reason);assert.equal(envelope.error.code,mode==='domain-throw'?'MODEL_UNAVAILABLE':'ROLE_GENERATION_FAILED');assert.equal(envelope.data,undefined);
   }
   global.fetch=(_url,options)=>f.route(new Request('http://localhost/api/agents/prepare',options));
   const {api}=require('../web/api/client.ts');await assert.rejects(api.prepareAgent(body,new AbortController().signal),error=>error.message===reason);
   assert.deepEqual(currentDraft,before);
  }
  assert.equal(f.state.created,f.state.disposed);
 }finally{global.fetch=previous;f.close();}
});
test('unified polish API extracts one JSON draft from model prose and rejects malformed candidates',async()=>{
 const f=await setup();
 try{
  const currentDraft=definition({kind:'project',projectId:'p'}),body={mode:'generate',currentDraft,inputText:'直接输入'};
  f.state.answer='已整理。\n```json\n{"name":"Polished","text":"完整润色结果\\n第二行\\n示例 {name,text}","warnings":["保留"]}\\n```\n请查看。';
  const response=await f.call(body),data=(await response.json()).data;assert.equal(response.status,200);assert.equal(data.definition.systemPrompt,'完整润色结果\n第二行\n示例 {name,text}');assert.deepEqual(data.warnings,['保留']);
  for(const answer of ['没有对象','{"text":"残缺','[]','{"text":"一"} {"text":"二"}','{"unexpected":true}','  原始回复\n第二行  ']){
   f.state.answer=answer;const failed=await f.call(body),envelope=await failed.json();assert.equal(failed.status,422);assert.equal(envelope.error.code,'ROLE_GENERATION_INVALID');assert.equal(envelope.error.message,answer);assert.equal(envelope.data,undefined);
  }
  assert.deepEqual(currentDraft,definition({kind:'project',projectId:'p'}));assert.equal(f.state.created,f.state.disposed);
 }finally{f.close();}
});
test('unified polish API retains cancellation and missing-reason fallbacks, without returning a new draft',async()=>{
 const f=await setup();
 try{
  const currentDraft=definition(),body={mode:'generate',currentDraft,inputText:'直接输入'},before=structuredClone(currentDraft);
  for(const [mode,reason,expected] of [['missing','','模型未生成有效助手内容'],['provider-error','','模型未生成有效助手内容'],['empty','','模型返回空内容']]){
   f.state.mode=mode;f.state.reason=reason;const response=await f.call(body),envelope=await response.json();assert.equal(response.status,503);assert.equal(envelope.error.message,expected);assert.equal(envelope.data,undefined);
  }
  f.state.mode='blank-content';f.state.reason='  \n  ';const blank=await f.call(body),blankBody=await blank.json();assert.equal(blank.status,503);assert.equal(blankBody.error.message,'模型原始内容：  \n  ');assert.equal(blankBody.data,undefined);
  const abort=new AbortController();abort.abort();const response=await f.call(body,false,abort.signal);assert.equal(response.status,409);assert.equal((await response.json()).error.code,'REQUEST_ABORTED');assert.deepEqual(currentDraft,before);assert.equal(f.state.created,f.state.disposed);
 }finally{f.close();}
});
