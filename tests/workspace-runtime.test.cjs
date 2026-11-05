require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {workspacePrompt}=require('../src/domain/workspace.ts');
test('production runtime restores exact native identity, uses native coding tools, and retains full native branches',async()=>{
 const pi=await import('@earendil-works/pi-coding-agent'),ai=await import('@earendil-works/pi-ai'),Module=require('node:module'),original=Module._load;
 Module._load=function(spec,...args){return spec==='@earendil-works/pi-coding-agent'?pi:spec==='@earendil-works/pi-ai'?ai:original.call(this,spec,...args);};
 let PiSessionRuntime,initializeSession;try{({PiSessionRuntime}=require('../src/infrastructure/pi/pi-session-runtime.server.ts'));({initializeSession}=require('../src/infrastructure/pi/initialize-session.server.ts'));}finally{Module._load=original;}
 const {ModelRuntime,SessionManager}=pi;
 const {pathToFileURL}=require('node:url');
 const transport=await import(pathToFileURL(path.join(__dirname,'../node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js')).href);
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'workspace-runtime-'))),a=path.join(root,'a'),b=path.join(root,'b');fs.mkdirSync(a);fs.mkdirSync(b);fs.writeFileSync(path.join(a,'file'),'A');
 const credentials={async read(){},async list(){return []},async modify(){},async delete(){}};
 const modelRuntime=await ModelRuntime.create({credentials,modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});modelRuntime.registerProvider('fake',{name:'fake',baseUrl:'http://localhost',apiKey:'fake',api:'openai-completions',models:[{id:'fake',name:'fake',api:'openai-completions',baseUrl:'http://localhost',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1000}]});
 const runtime=new PiSessionRuntime(async()=>({runtime:modelRuntime,model:modelRuntime.getModel('fake','fake')}));
 const manager=initializeSession('fixture',a,root);const nativeRef={kind:'pi',sessionId:manager.getSessionId(),sessionFile:manager.getSessionFile(),cwd:a};
 const w={id:'w',name:'Work',projects:[{id:'a',workspaceId:'w',name:'a',rootPath:a},{id:'b',workspaceId:'w',name:'b',rootPath:b}]};
 const input={session:{id:'s',nativeRef,agentSnapshot:null,state:'idle'},workingDirectory:a,allowProjectRead:true,allowProjectWrite:true,independentProjectTools:true,workspace:{...w,defaultProjectId:'a',prompt:workspacePrompt(w,'a')}};
 let handle;
 try{
  handle=await runtime.restore(input);assert.equal(handle.session.sessionId,nativeRef.sessionId);assert.equal(handle.session.sessionFile,nativeRef.sessionFile);
  const names=handle.session.getActiveToolNames();assert.deepEqual([...names].sort(),['bash','edit','read','write']);
  assert(!handle.session.getAllTools().some(tool=>/^(workspace_|project_)/.test(tool.name)));
  assert(!handle.session.getCallableToolNames().some(name=>/^(workspace_|project_)/.test(name)));
  const one=handle.manager.appendMessage({role:'user',content:'first branch',timestamp:Date.now()});handle.manager.resetLeaf();const two=handle.manager.appendMessage({role:'user',content:'second branch',timestamp:Date.now()});
  const nativeBeforeJournal=fs.readFileSync(nativeRef.sessionFile,'utf8');
  runtime.requestEntry(handle,'workspace_request',{key:'k',hash:'h'});assert.equal(runtime.requestEntries(handle).length,1);
  assert.equal(fs.readFileSync(nativeRef.sessionFile,'utf8'),nativeBeforeJournal,'application evidence must not change Pi file');
  const tree=await runtime.readTree(input);assert(tree.entries.some(({entry})=>entry.id===one));assert(tree.entries.some(({entry})=>entry.id===two));
  await runtime.close(handle);handle=null;const before=fs.readFileSync(nativeRef.sessionFile,'utf8');
  assert.equal((await runtime.readRequestEntries(input))[0].data.key,'k');
  assert.equal(fs.readFileSync(nativeRef.sessionFile,'utf8'),before);
  const history=await runtime.history(input);assert.equal(history.requests.length,1);assert.equal(history.requests[0].user,'second branch');assert.equal(fs.readFileSync(nativeRef.sessionFile,'utf8'),before);
  // Reproduce an existing conversation with obsolete tool declarations and successful calls.
  const legacy=SessionManager.open(nativeRef.sessionFile);
  legacy.appendMessage({role:'system',content:'',sections:{addendum:'Old workspace prompt',tools:'workspace_list, workspace_read'},toolsAdded:['workspace_list','workspace_read'].map(name=>({name,description:'obsolete workspace tool',parameters:{type:'object',properties:{}}})),timestamp:Date.now()});
  legacy.appendMessage({role:'assistant',content:[{type:'toolCall',id:'legacy-list',name:'workspace_list',arguments:{}}],api:'openai-completions',provider:'fake',model:'fake',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'toolUse',timestamp:Date.now()});
  legacy.appendMessage({role:'toolResult',toolCallId:'legacy-list',toolName:'workspace_list',content:[{type:'text',text:'old project listing'}],isError:false,timestamp:Date.now()});
  const legacyBeforeRestore=fs.readFileSync(nativeRef.sessionFile,'utf8');
  handle=await runtime.restore(input);assert.equal(runtime.requestEntries(handle)[0].data.key,'k');assert.equal(handle.manager.getSessionId(),nativeRef.sessionId);
  const calls=[],payloads=[],payloadTasks=[];let networkAttempted=false;
  function capture(h){h.session.agent.streamFunction=(_model,context)=>{
   payloadTasks.push(transport.stream(_model,context,{apiKey:'offline-test',onPayload(payload){payloads.push(payload);throw new Error('Offline capture complete');},fetch:async()=>{networkAttempted=true;throw new Error('Network forbidden');}}).result());
   calls.push({systemPrompt:ai.getCurrentSystemPrompt(context.messages),messages:structuredClone(context.messages.filter(message=>message.role!=='system')),systemMessages:structuredClone(context.messages.filter(message=>message.role==='system'))});
   const stream=ai.createAssistantMessageEventStream(),message={role:'assistant',content:[{type:'text',text:'ok'}],api:'openai-completions',provider:'fake',model:'fake',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()};
   stream.push({type:'done',reason:'stop',message});stream.end();return stream;
  };}
  capture(handle);
  await runtime.send(handle,'verify workspace system prompt',()=>{},undefined,undefined,true);
  assert.match(calls[0].systemPrompt,/coding assistant/i);
  assert(calls[0].systemPrompt.includes(input.workspace.prompt));
  await Promise.all(payloadTasks);
  assert(fs.readFileSync(nativeRef.sessionFile,'utf8').startsWith(legacyBeforeRestore),'old declarations and tool calls remain unchanged');
  assert(payloads[0].messages.some(message=>message.tool_calls?.some(call=>call.function.name==='workspace_list')),'historical calls remain in model context');
  assert(!JSON.stringify(calls[0].messages).includes('defaultProjectId'),'workspace structure belongs to system prompt, not chat messages');
  assert(!JSON.stringify(calls[0].messages).includes('workspace_request'),'request bookkeeping must not become model messages');
  assert.equal(runtime.requestEntries(handle).length,1,'runtime send must not manufacture workspace context nodes');
  const changedWorkspace={...w,name:'Updated workspace'};
  const changedInput={...input,workspace:{...input.workspace,prompt:workspacePrompt(changedWorkspace,'a')}};
  assert.equal(runtime.getHandle(input.session.id,changedInput),undefined);
  handle=await runtime.restore(changedInput);capture(handle);
  await runtime.send(handle,'verify refreshed workspace',()=>{},undefined,undefined,true);
  assert(calls[1].systemPrompt.includes(changedInput.workspace.prompt));
  assert(!calls[1].systemPrompt.includes(input.workspace.prompt));
  await Promise.all(payloadTasks);
  assert.equal(payloads.length,2);assert.equal(networkAttempted,false);
  for(const [index,payload] of payloads.entries()){
   const system=payload.messages.filter(message=>message.role==='system').map(message=>message.content).join('\n');
   assert(system.includes(index===0?input.workspace.prompt:changedInput.workspace.prompt));
   for(const project of w.projects)assert(system.includes(project.rootPath));
   assert.deepEqual(payload.tools.map(tool=>tool.function.name).sort(),['bash','edit','read','write']);
   assert(!system.includes('Old workspace prompt'));
   assert.match(system,/workspace_\*.*已经退役/);
   assert.match(system,/不从知识库、README 或历史工具结果反推/);
  }
  assert.equal(handle.session.sessionId,nativeRef.sessionId);
  const nativeCalls=[
   {name:'read',arguments:{path:'file'}},
   {name:'write',arguments:{path:path.join(b,'cross.txt'),content:'B'}},
   {name:'edit',arguments:{path:path.join(b,'cross.txt'),oldText:'B',newText:'BB'}},
   {name:'read',arguments:{path:path.join(b,'cross.txt')}},
   {name:'bash',arguments:{command:'pwd',timeout:5}},
  ];let toolIndex=0;
  handle.session.agent.streamFunction=()=>{
   const call=nativeCalls[toolIndex++];
   const stream=ai.createAssistantMessageEventStream(),message={role:'assistant',content:call?[{type:'toolCall',id:'actual-tool-'+toolIndex,...call}]:[{type:'text',text:'done'}],api:'openai-completions',provider:'fake',model:'fake',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:call?'toolUse':'stop',timestamp:Date.now()};stream.push({type:'done',reason:message.stopReason,message});stream.end();return stream;
  };
  await runtime.send(handle,'read default project, write and edit the second project, check cwd',()=>{},undefined,undefined,true);
  assert.equal(fs.readFileSync(path.join(b,'cross.txt'),'utf8'),'BB');
  assert.equal(fs.readFileSync(path.join(a,'file'),'utf8'),'A');
  runtime.requestEntry(handle,'workspace_request_result',{key:'k',hash:'h',outcome:'settled'});
  const nativeEntries=handle.manager.getEntries();
  assert(!nativeEntries.some(entry=>entry.type==='custom'&&entry.customType.startsWith('workspace_request')));
  const results=nativeEntries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult'&&entry.message.toolCallId.startsWith('actual-tool-')).map(entry=>entry.message);
  assert.equal(results.length,5);assert(results.every(result=>!result.isError));
  assert.equal(results[0].toolName,'read');assert(results[0].content.some(block=>block.text?.includes('A')));
  assert(results[3].content.some(block=>block.text?.includes('BB')));
  assert.equal(results[4].toolName,'bash');assert(results[4].content.some(block=>block.text?.includes(a)));
  // Old custom evidence remains readable; acknowledging it writes only the sidecar.
  handle.manager.appendCustomEntry('workspace_request',{key:'legacy',hash:'legacy-hash'});
  const beforeAck=fs.readFileSync(nativeRef.sessionFile,'utf8');
  runtime.requestEntry(handle,'workspace_request_acknowledged',{key:'legacy',hash:'legacy-hash'});
  assert.equal(fs.readFileSync(nativeRef.sessionFile,'utf8'),beforeAck);
  await runtime.close(handle);handle=null;
  const cold=await runtime.readRequestEntries(changedInput);assert(cold.some(entry=>entry.type==='workspace_request'&&entry.data.key==='legacy'));assert(cold.some(entry=>entry.type==='workspace_request_acknowledged'&&entry.data.key==='legacy'));
 }finally{if(handle)await runtime.close(handle);fs.rmSync(root,{recursive:true,force:true});}
});
