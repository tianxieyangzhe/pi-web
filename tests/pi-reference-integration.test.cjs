require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createMessageReferenceScope}=require('../src/infrastructure/pi/message-reference-scope.server.ts');
const {appendMessageReferences}=require('../src/infrastructure/pi/message-references.server.ts');

test('Pi model requests contain only the active turn reference, including after restoration',async()=>{
 const {DefaultResourceLoader,createAgentSession,SessionManager,SettingsManager,ModelRuntime}=await import('@earendil-works/pi-coding-agent');
 const {createAssistantMessageEventStream}=await import('@earendil-works/pi-ai');
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'pi-ref-integration-'));
 const credentials={async read(){},async list(){return []},async modify(){},async delete(){}};
 const runtime=await ModelRuntime.create({credentials,modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
 runtime.registerProvider('fake',{name:'fake',baseUrl:'http://localhost',apiKey:'fake',api:'openai-completions',models:[{id:'fake',name:'fake',api:'openai-completions',baseUrl:'http://localhost',reasoning:false,input:['text','image'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1000}]});
 const model=runtime.getModel('fake','fake'),manager=SessionManager.inMemory(cwd),calls=[];
 async function open(){
  const scope=createMessageReferenceScope(),loader=new DefaultResourceLoader({cwd,agentDir:cwd,noExtensions:true,noSkills:true,noContextFiles:true,noPromptTemplates:true,noThemes:true,extensionFactories:[scope.extension]});await loader.reload();
  const {session}=await createAgentSession({cwd,modelRuntime:runtime,model,resourceLoader:loader,sessionManager:manager,settingsManager:SettingsManager.inMemory({compaction:{enabled:false}}),noTools:'all'});
  session.agent.streamFunction=(_model,context)=>{calls.push(JSON.stringify(context.messages));const stream=createAssistantMessageEventStream();const message={role:'assistant',content:[{type:'text',text:'ok'}],api:'openai-completions',provider:'fake',model:'fake',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()};stream.push({type:'done',reason:'stop',message});stream.end();return stream;};return {session,scope};
 }
 try{
  let h=await open();let id=h.scope.begin();await appendMessageReferences(h.session,[{type:'text',text:'ONE_SECRET'},{type:'image',mimeType:'image/png',data:'aW1hZ2Ux'}],id);await h.session.prompt('one',{expandPromptTemplates:false});h.scope.end();
  id=h.scope.begin();await h.session.prompt('two',{expandPromptTemplates:false});h.scope.end();h.session.dispose();
  h=await open();id=h.scope.begin();await appendMessageReferences(h.session,[{type:'text',text:'THREE_SECRET'}],id);await h.session.prompt('three',{expandPromptTemplates:false});h.scope.end();h.session.dispose();
  assert.equal(calls.length,3);assert.match(calls[0],/ONE_SECRET/);assert.match(calls[0],/aW1hZ2Ux/);assert.doesNotMatch(calls[1],/ONE_SECRET|aW1hZ2Ux/);assert.doesNotMatch(calls[2],/ONE_SECRET|aW1hZ2Ux/);assert.match(calls[2],/THREE_SECRET/);
 }finally{fs.rmSync(cwd,{recursive:true,force:true});}
});
