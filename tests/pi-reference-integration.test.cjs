require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createMessageReferenceScope}=require('../src/infrastructure/pi/message-reference-scope.server.ts');
const {appendMessageReferences}=require('../src/infrastructure/pi/message-references.server.ts');
const {referenceTreeProjection}=require('../web/workspace/conversation/reference-tree-projection.ts');

test('Pi preserves image and file references on follow-up and restoration without crossing branches',async()=>{
 const {DefaultResourceLoader,createAgentSession,SessionManager,SettingsManager,ModelRuntime}=await import('@earendil-works/pi-coding-agent');
 const {createAssistantMessageEventStream}=await import('@earendil-works/pi-ai');
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'pi-ref-integration-'));
 const credentials={async read(){},async list(){return []},async modify(){},async delete(){}};
 const runtime=await ModelRuntime.create({credentials,modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
 runtime.registerProvider('fake',{name:'fake',baseUrl:'http://localhost',apiKey:'fake',api:'openai-completions',models:[{id:'fake',name:'fake',api:'openai-completions',baseUrl:'http://localhost',reasoning:false,input:['text','image'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1000}]});
 const model=runtime.getModel('fake','fake'),manager=SessionManager.inMemory(cwd),calls=[],payloads=[],payloadTasks=[];
 const {pathToFileURL}=require('node:url');
 const transports=await Promise.all(['openai-completions','openai-responses'].map(api=>import(pathToFileURL(path.join(__dirname,`../node_modules/@earendil-works/pi-ai/dist/api/${api}.js`)).href)));
 let networkAttempted=false;
 async function open(){
  const scope=createMessageReferenceScope(),loader=new DefaultResourceLoader({cwd,agentDir:cwd,noExtensions:true,noSkills:true,noContextFiles:true,noPromptTemplates:true,noThemes:true,extensionFactories:[scope.extension]});await loader.reload();
  const {session}=await createAgentSession({cwd,modelRuntime:runtime,model,resourceLoader:loader,sessionManager:manager,settingsManager:SettingsManager.inMemory({compaction:{enabled:false}}),noTools:'all'});
  session.agent.streamFunction=(_model,context)=>{calls.push(JSON.stringify(context.messages));for(const [index,transport] of transports.entries())payloadTasks.push(transport.stream({..._model,api:index===0?'openai-completions':'openai-responses'},context,{apiKey:'offline-test',onPayload(payload){payloads.push({index,turn:calls.length,payload});throw new Error('Offline capture complete');},fetch:async()=>{networkAttempted=true;throw new Error('Network forbidden');}}).result());const stream=createAssistantMessageEventStream();const message={role:'assistant',content:[{type:'text',text:'ok'}],api:'openai-completions',provider:'fake',model:'fake',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()};stream.push({type:'done',reason:'stop',message});stream.end();return stream;};return {session,scope};
 }
 try{
  let h=await open();let id=h.scope.begin();await appendMessageReferences(h.session,[{type:'text',text:'ONE_SECRET'},{type:'image',mimeType:'image/png',data:'aW1hZ2Ux'}],id);await h.session.prompt('one',{expandPromptTemplates:false});h.scope.end();
  id=h.scope.begin();await h.session.prompt('two',{expandPromptTemplates:false});h.scope.end();h.session.dispose();
  h=await open();id=h.scope.begin();await appendMessageReferences(h.session,[{type:'text',text:'THREE_SECRET'}],id);await h.session.prompt('three',{expandPromptTemplates:false});h.scope.end();h.session.dispose();
  const projection=referenceTreeProjection({entries:manager.getEntries().map(entry=>({entry,label:null,labelTimestamp:null})),activeLeafId:manager.getLeafId()});
  assert.equal(projection.attachments.size,2,'real Pi reference nodes must group with their user messages');
  assert.deepEqual([...projection.attachments.keys()].map(id=>require('../web/workspace/conversation/session-tree-projection.ts').contentBlocks(manager.getEntry(id).message.content).map(block=>block.text??'').join('')),['one','three']);
  await Promise.all(payloadTasks);assert.equal(networkAttempted,false);assert.equal(payloads.length,6);
  for(const index of [0,1]){
   const first=payloads.find(item=>item.index===index&&item.turn===1).payload;
   const messages=index===0?first.messages:first.input;
   const blocks=messages.flatMap(message=>Array.isArray(message.content)?message.content:[]);
   assert.ok(blocks.some(block=>block.text?.includes('ONE_SECRET')));
   assert.ok(blocks.some(block=>index===0?block.type==='image_url'&&block.image_url.url==='data:image/png;base64,aW1hZ2Ux':block.type==='input_image'&&block.image_url==='data:image/png;base64,aW1hZ2Ux'));
   for(const item of payloads.filter(item=>item.index===index&&item.turn!==1)){
    assert.match(JSON.stringify(item.payload),/ONE_SECRET/);assert.match(JSON.stringify(item.payload),/aW1hZ2Ux/);
   }
  }
  assert.equal(calls.length,3);assert.match(calls[0],/ONE_SECRET/);assert.match(calls[0],/aW1hZ2Ux/);assert.match(calls[1],/ONE_SECRET/);assert.match(calls[1],/aW1hZ2Ux/);assert.match(calls[2],/ONE_SECRET/);assert.match(calls[2],/aW1hZ2Ux/);assert.match(calls[2],/THREE_SECRET/);
  const reference=manager.getEntries().find(entry=>entry.type==='custom_message'&&entry.customType==='user_reference_files');
  if(reference.parentId)manager.branch(reference.parentId);else manager.resetLeaf();
  h=await open();h.scope.begin();await h.session.prompt('separate branch',{expandPromptTemplates:false});h.scope.end();h.session.dispose();
  await Promise.all(payloadTasks);assert.equal(calls.length,4);assert.doesNotMatch(calls[3],/ONE_SECRET|aW1hZ2Ux|THREE_SECRET/);
  for(const item of payloads.filter(item=>item.turn===4))assert.doesNotMatch(JSON.stringify(item.payload),/ONE_SECRET|aW1hZ2Ux|THREE_SECRET/);
  assert.equal(networkAttempted,false);
 }finally{fs.rmSync(cwd,{recursive:true,force:true});}
});
