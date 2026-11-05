const {test}=require('node:test');
const assert=require('node:assert/strict');

test('independent Pi sessions expose natural output to an observer and custom messages wake the coordinator',async()=>{
 const {createAgentSession,SessionManager,SettingsManager,DefaultResourceLoader,ModelRuntime}=await import('@earendil-works/pi-coding-agent');
 const {createAssistantMessageEventStream}=await import('@earendil-works/pi-ai');
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'pi-observer-')),sessions=[];
 try{
  const runtime=await ModelRuntime.create({credentials:{async read(){},async list(){return []},async modify(){},async delete(){}},modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
  runtime.registerProvider('fake',{name:'fake',baseUrl:'http://localhost',apiKey:'fake',api:'openai-completions',models:[{id:'fake',name:'fake',api:'openai-completions',baseUrl:'http://localhost',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1000}]});
  async function open(name){
   const root=path.join(cwd,name);fs.mkdirSync(root);
   const loader=new DefaultResourceLoader({cwd:root,agentDir:root,noExtensions:true,noSkills:true,noContextFiles:true,noPromptTemplates:true,noThemes:true});await loader.reload();
   const manager=SessionManager.inMemory(root),requests=[];
   const {session}=await createAgentSession({cwd:root,modelRuntime:runtime,model:runtime.getModel('fake','fake'),resourceLoader:loader,sessionManager:manager,settingsManager:SettingsManager.inMemory({compaction:{enabled:false}}),noTools:'all'});
   sessions.push(session);
   session.agent.streamFunction=(_model,context)=>{
    requests.push(JSON.stringify(context.messages));
    const stream=createAssistantMessageEventStream(),message={role:'assistant',content:[{type:'text',text:`${name}: natural project output without a report schema`}],api:'openai-completions',provider:'fake',model:'fake',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()};
    stream.push({type:'done',reason:'stop',message});stream.end();return stream;
   };
   return {session,manager,requests};
  }
  const bot=await open('bot'),front=await open('frontend'),back=await open('backend'),observed=[],otherListener=[],settled=[];
  const stop=front.session.subscribe(event=>{if(event.type==='message_end'&&event.message.role==='assistant')observed.push({source:'frontend',message:event.message});if(event.type==='agent_settled')settled.push('frontend');});
  front.session.subscribe(event=>otherListener.push(event.type));
  back.session.subscribe(event=>{if(event.type==='message_end'&&event.message.role==='assistant')observed.push({source:'backend',message:event.message});if(event.type==='agent_settled')settled.push('backend');});
  await Promise.all([front.session.prompt('Investigate frontend'),back.session.prompt('Investigate backend')]);
  assert.equal(observed.length,2);assert.equal(settled.length,2);assert.ok(otherListener.includes('message_end'));
  assert.equal(bot.requests.length,0,'subscription alone does not trigger coordinator inference');
  await bot.session.sendCustomMessage({customType:'project_observation',content:observed.map(item=>`${item.source}: ${item.message.content[0].text}`).join('\n'),display:true,details:{sources:observed.map(item=>item.source)}},{triggerTurn:true,deliverAs:'followUp'});
  assert.equal(bot.requests.length,1);assert.match(bot.requests[0],/frontend: natural/);assert.match(bot.requests[0],/backend: natural/);
  assert.equal(bot.manager.getEntries().filter(entry=>entry.type==='custom_message').length,1);
  assert.ok(front.manager.getTree().length);assert.notEqual(front.manager.getSessionId(),back.manager.getSessionId());
  const count=observed.length;stop();await front.session.prompt('Continue frontend');assert.equal(observed.length,count);assert.ok(otherListener.filter(type=>type==='agent_settled').length>=2);
 }finally{for(const session of sessions)session.dispose();fs.rmSync(cwd,{recursive:true,force:true});}
});
