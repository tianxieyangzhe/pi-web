require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
const {createAgentPreparationService}=require('../src/application/agent-service.ts');
const {createGenerationSkills}=require('../src/infrastructure/agents/generation-skills.server.ts');
const {createAgentPreparationApi}=require('../src/shared/protocol/agent-preparation-api.server.ts');
const skills=createGenerationSkills();
const draft=()=>({format:3,mode:'generated',scope:'workspace',source:{kind:'workspace',workspaceId:'w',projectIds:['p','q']},systemPrompt:'',projects:[]});
const request=(body,signal)=>new Request('http://localhost/api/agents/prepare',{method:'POST',headers:{'content-type':'application/json',accept:'application/x-ndjson'},body:JSON.stringify(body),signal});

test('prepare API uses real Pi read loop in each project cwd, full skill, more than ten files, and serial live progress',async()=>{
 const pi=await import('@earendil-works/pi-coding-agent'),ai=await import('@earendil-works/pi-ai');
 const original=Module._load;let createAgentGenerator;
 Module._load=function(name,...args){return name==='@earendil-works/pi-coding-agent'?pi:name==='@earendil-works/pi-ai'?ai:original.call(this,name,...args);};
 try{({createAgentGenerator}=require('../src/infrastructure/pi/agent-generation.server.ts'));}finally{Module._load=original;}
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-generation-'));
 const runtime=await pi.ModelRuntime.create({credentials:{async read(){},async list(){return [];},async modify(){},async delete(){}},modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
 runtime.registerProvider('fake',{name:'fake',baseUrl:'http://localhost',apiKey:'fake',api:'openai-completions',models:[{id:'fake',name:'fake',api:'openai-completions',baseUrl:'http://localhost',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:256000,maxTokens:1000}]});
 const created=[],finished=[],readCounts={};let active=0,maxActive=0,withSkill=true;
 const generate=createAgentGenerator(async()=>({runtime,model:runtime.getModel('fake','fake')}),async options=>{
  assert.deepEqual(options.tools,['read','grep','find','ls']);assert.equal(options.settingsManager.getCompactionSettings().enabled,true);
  const project=path.basename(options.cwd);created.push(project);active++;maxActive=Math.max(maxActive,active);
  const result=await pi.createAgentSession(options);let step=0;
  const dispose=result.session.dispose.bind(result.session);result.session.dispose=()=>{active--;finished.push(project);dispose();};
  result.session.agent.streamFunction=(_model,context)=>{
   const systemPrompt=ai.getCurrentSystemPrompt(context.messages);if(withSkill)assert(systemPrompt.includes(fs.readFileSync('skills/create-agentsmd/SKILL.md','utf8')));else{assert(!systemPrompt.includes('<selected_skill>'));assert(systemPrompt.includes('自主规划调查'));}
   const toolResults=context.messages.filter(m=>m.role==='toolResult');
   if(step>0){const text=toolResults.at(-1).content.filter(c=>c.type==='text').map(c=>c.text).join('');assert(text.includes(`FACT_${project}_${step-1}`),text.slice(0,200));}
   const content=step<12?[{type:'toolCall',id:`read-${step}`,name:'read',arguments:{path:`fact-${step}.md`}}]:[{type:'text',text:JSON.stringify({name:project,rules:[{id:project,rules:`# ${project}\nVerified twelve source files`}],warnings:[]})}];
   const reason=step<12?'toolUse':'stop';step++;readCounts[project]=toolResults.length;
   const stream=ai.createAssistantMessageEventStream();stream.push({type:'done',reason,message:{role:'assistant',content,api:'openai-completions',provider:'fake',model:'fake',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:reason,timestamp:Date.now()}});stream.end();return stream;
  };return result;
 });
 try{
  const projects=['p','q'].map(id=>{const cwd=path.join(root,id);fs.mkdirSync(cwd);for(let i=0;i<12;i++)fs.writeFileSync(path.join(cwd,`fact-${i}.md`),`FACT_${id}_${i}\n`+'evidence '.repeat(2800));return {id,name:id,rootPath:cwd};});
  const route=createAgentPreparationApi(createAgentPreparationService({skills,resolveSource:()=>projects,generate}));
  const response=await route(request({mode:'generate',currentDraft:draft(),target:'projects'}));assert.equal(response.headers.get('content-type'),'application/x-ndjson; charset=utf-8');
  const reader=response.body.getReader(),decoder=new TextDecoder();let text='';const first=await reader.read();text+=decoder.decode(first.value);assert(text.includes('"phase":"started"'));assert(!text.includes('"type":"result"'));
  while(true){const next=await reader.read();if(next.done)break;text+=decoder.decode(next.value,{stream:true});}
  const events=text.trim().split('\n').map(line=>JSON.parse(line));assert(!events.some(e=>e.type==='error'),text);assert.equal(events.at(-1).type,'result');assert.deepEqual(created,['p','q']);assert.deepEqual(finished,['p','q']);assert.equal(maxActive,1);assert.deepEqual(readCounts,{p:12,q:12});
  const progress=events.filter(e=>e.type==='progress');assert.equal(progress.filter(e=>e.phase==='reading').length,24);assert.deepEqual(progress.filter(e=>e.phase==='completed').map(e=>e.projectId),['p','q']);assert(!JSON.stringify(progress).includes(root));assert.equal(events.at(-1).data.definition.workspaceRules,undefined);assert.equal(events.at(-1).data.definition.projects.length,2);
  withSkill=false;const withoutSkill=await route(request({mode:'generate',currentDraft:draft(),target:'projects',skillId:null}));const directEvents=(await withoutSkill.text()).trim().split('\n').map(JSON.parse);assert.equal(directEvents.at(-1).type,'result');assert.equal(directEvents.at(-1).data.skill,null);assert.deepEqual(readCounts,{p:12,q:12});assert.equal(maxActive,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('prepare streaming API abort stops the queue and never emits a result or writes a partial draft',async()=>{
 let enter,release;const entered=new Promise(r=>enter=r);let calls=0;
 const original=draft(),before=JSON.stringify(original);
 const route=createAgentPreparationApi(createAgentPreparationService({skills,resolveSource:()=>['p','q'].map(id=>({id,name:id,rootPath:'/unused/'+id})),generate:async(_input,signal)=>{calls++;enter();await new Promise((resolve,reject)=>{release=resolve;signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});return JSON.stringify({rules:[{id:'p',rules:'partial'}]});}}));
 const abort=new AbortController(),response=await route(request({mode:'generate',currentDraft:original},abort.signal));const reader=response.body.getReader();await reader.read();await entered;abort.abort();release();
 const end=await reader.read();assert.equal(end.done,true);assert.equal(calls,1);assert.equal(JSON.stringify(original),before);
});

test('prepare streaming API exposes errors after progress, without completion or a final draft',async()=>{
 let calls=0;
 const route=createAgentPreparationApi(createAgentPreparationService({skills,resolveSource:()=>['p','q'].map(id=>({id,name:id,rootPath:'/unused/'+id})),generate:async()=>{calls++;return JSON.stringify({rules:[{id:'wrong',rules:'invalid'}]});}}));
 const response=await route(request({mode:'generate',currentDraft:draft()}));const events=(await response.text()).trim().split('\n').map(JSON.parse);assert.equal(events[0].phase,'started');assert.equal(events.at(-1).type,'error');assert.equal(events.at(-1).error.code,'ROLE_GENERATION_INVALID');assert(!events.some(e=>e.type==='result'||e.phase==='completed'));assert.equal(calls,1);
});


test('skill reference GET API returns complete Markdown and hash, rejecting missing and invalid IDs',async()=>{
 const service=createAgentPreparationService({skills,resolveSource:()=>[],generate:async()=>{throw Error('must not generate');}});
 const original=Module._load;let GET;
 Module._load=function(name,...args){return name==='@/bootstrap/composition-root.server'?{services:{agentPreparation:service}}:original.call(this,name,...args);};
 try{({GET}=require('../src/app/api/agents/skills/[skillId]/route.ts'));}finally{Module._load=original;}
 const get=id=>GET(new Request('http://localhost/api/agents/skills/'+encodeURIComponent(id)),{params:Promise.resolve({skillId:id})});
 const response=await get('create-agentsmd'),body=await response.json();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(body.data.content,fs.readFileSync('skills/create-agentsmd/SKILL.md','utf8'));assert.equal(body.data.sha256,require('node:crypto').createHash('sha256').update(body.data.content).digest('hex'));assert.equal(body.data.path,undefined);
 const missing=await get('missing');assert.equal(missing.status,404);assert.equal((await missing.json()).error.code,'GENERATION_SKILL_NOT_FOUND');
 const invalid=await get('../outside');assert.equal(invalid.status,400);assert.equal((await invalid.json()).error.code,'INVALID_INPUT');
});
