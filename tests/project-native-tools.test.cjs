require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('independent production Pi uses native tools, executes Python, reads attachments, restores exact history and scopes read-only requests',async()=>{
 const pi=await import('@earendil-works/pi-coding-agent'),ai=await import('@earendil-works/pi-ai'),Module=require('node:module'),load=Module._load;
 Module._load=function(name,...args){return name==='@earendil-works/pi-coding-agent'?pi:name==='@earendil-works/pi-ai'?ai:load.call(this,name,...args);};
 let PiSessionRuntime,initializeSession;try{({PiSessionRuntime}=require('../src/infrastructure/pi/pi-session-runtime.server.ts'));({initializeSession}=require('./support/initialize-pi-session.ts'));}finally{Module._load=load;}
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'project-native-tools-'))),cwd=path.join(root,'project');fs.mkdirSync(cwd);
 const attachment=path.join(root,'attachment.txt');fs.writeFileSync(attachment,'ATTACHMENT_BYTES');
 const credentials={async read(){},async list(){return []},async modify(){},async delete(){}};
 const models=await pi.ModelRuntime.create({credentials,modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
 models.registerProvider('fake',{name:'fake',baseUrl:'http://localhost',apiKey:'fake',api:'openai-completions',models:[{id:'fake',name:'fake',api:'openai-completions',baseUrl:'http://localhost',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1000}]});
 const runtime=new PiSessionRuntime(async()=>({runtime:models,model:models.getModel('fake','fake')}));
 const manager=initializeSession('native-tools',cwd,root),nativeRef={kind:'pi',sessionId:manager.getSessionId(),sessionFile:manager.getSessionFile(),cwd};
 const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
 function message(content,stopReason='stop'){return {role:'assistant',content,api:'openai-completions',provider:'fake',model:'fake',usage,stopReason,timestamp:Date.now()};}
 const legacy=manager.appendMessage(message([{type:'toolCall',id:'old-read',name:'project_read',arguments:{path:'old.txt'}}],'toolUse'));
 manager.appendMessage({role:'toolResult',toolCallId:'old-read',toolName:'project_read',content:[{type:'text',text:'HISTORICAL_RESULT'}],isError:false,timestamp:Date.now()});
 const prefix=fs.readFileSync(nativeRef.sessionFile,'utf8');
 const input={session:{id:'native-tools',nativeRef,agentSnapshot:null,state:'idle'},workingDirectory:cwd,nativeCodingTools:true,allowProjectRead:true,allowProjectWrite:true};
 const standard=['bash','edit','read','write'];let handle;
 function assertTools(names=standard){assert.deepEqual(handle.session.getActiveToolNames().sort(),[...names].sort());assert(!handle.session.getAllTools().some(tool=>/^(project_|bot_|coordinator_)/.test(tool.name)));if(names.length===1)assert(!handle.session.getCallableToolNames().some(name=>['bash','edit','write'].includes(name)));}
 function stream(content,reason='stop'){const s=ai.createAssistantMessageEventStream();s.push({type:'done',reason,message:message(content,reason)});s.end();return s;}
 try{
  handle=await runtime.restore(input);assertTools();assert.equal(handle.session.sessionId,nativeRef.sessionId);assert.equal(handle.session.sessionFile,nativeRef.sessionFile);
  const actions=[['write',{path:'report.txt',content:'before'}],['edit',{path:'report.txt',oldText:'before',newText:'after'}],['read',{path:attachment}],['bash',{command:'python3 -c \'from pathlib import Path; Path("python-result.txt").write_text("PYTHON_OK"); print(Path.cwd())\''}]];
  let step=0,seenHistory=false;
  handle.session.agent.streamFunction=(_model,context)=>{
   assertTools();assert.match(ai.getCurrentSystemPrompt(context.messages),/coding assistant/i);
   seenHistory ||= JSON.stringify(context.messages).includes('HISTORICAL_RESULT');
   if(step<actions.length){const [name,args]=actions[step++];return stream([{type:'toolCall',id:'native-'+step,name,arguments:args}],'toolUse');}
   return stream([{type:'text',text:'done'}]);
  };
  await runtime.send(handle,'create report and verify Python',()=>{},undefined,undefined,true);
  assert.equal(step,4);assert.equal(seenHistory,true);assert.equal(fs.readFileSync(path.join(cwd,'report.txt'),'utf8'),'after');assert.equal(fs.readFileSync(path.join(cwd,'python-result.txt'),'utf8'),'PYTHON_OK');
  const results=handle.session.messages.filter(m=>m.role==='toolResult'&&m.toolCallId.startsWith('native-'));
  assert.equal(results.length,4);assert(results.every(r=>!r.isError));assert.match(JSON.stringify(results.find(r=>r.toolName==='read')),/ATTACHMENT_BYTES/);assert.match(JSON.stringify(results.find(r=>r.toolName==='bash')),new RegExp(cwd.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert(fs.readFileSync(nativeRef.sessionFile,'utf8').startsWith(prefix));
  handle.session.agent.streamFunction=()=>{assertTools(['read']);return stream([{type:'text',text:'read only'}]);};
  await runtime.send(handle,'inspect',()=>{},undefined,undefined,false);assertTools();
  handle.session.agent.streamFunction=()=>{assertTools(['read']);throw Error('controlled provider failure');};
  await assert.rejects(()=>runtime.send(handle,'fail',()=>{},undefined,undefined,false));assertTools();
  handle.session.agent.streamFunction=()=>{assertTools(['read']);return stream([],'aborted');};
  await assert.rejects(()=>runtime.send(handle,'abort',()=>{},undefined,undefined,false),e=>e.code==='REQUEST_ABORTED');assertTools();
  await runtime.close(handle);handle=null;
  // A role with all capability switches disabled still does not restrict independent native tools.
  const role={agentId:'guide',contentSha256:'a'.repeat(64),definition:{instructions:'ROLE_GUIDANCE',capabilities:{readFiles:false,writeFiles:false}}};
  handle=await runtime.restore({...input,session:{...input.session,agentSnapshot:role}});assertTools();assert.equal(handle.session.sessionId,nativeRef.sessionId);assert(handle.manager.getEntries().some(e=>e.id===legacy));
  handle.session.agent.streamFunction=(_model,context)=>{assertTools();assert.match(ai.getCurrentSystemPrompt(context.messages),/ROLE_GUIDANCE/);return stream([{type:'text',text:'restored'}]);};
  await runtime.send(handle,'continue',()=>{},undefined,undefined,true);assert(fs.readFileSync(nativeRef.sessionFile,'utf8').startsWith(prefix));
 }finally{if(handle)await runtime.close(handle);fs.rmSync(root,{recursive:true,force:true});}
});
