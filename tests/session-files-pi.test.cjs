require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {appendMessageReferences}=require('../src/infrastructure/pi/message-references.server.ts');
const {parseMessageReferences}=require('../src/domain/message-references.ts');
test('real Pi native read reads stored upload and retains its location after restoration',async()=>{
 const pi=await import('@earendil-works/pi-coding-agent'),ai=await import('@earendil-works/pi-ai');
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'session-upload-pi-'))),cwd=path.join(root,'project'),storage=path.join(root,'files');fs.mkdirSync(cwd);
 const credentials={async read(){},async list(){return []},async modify(){},async delete(){}};
 const runtime=await pi.ModelRuntime.create({credentials,modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
 runtime.registerProvider('fake',{name:'fake',baseUrl:'http://localhost',apiKey:'fake',api:'openai-completions',models:[{id:'fake',name:'fake',api:'openai-completions',baseUrl:'http://localhost',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1000}]});
 const manager=pi.SessionManager.inMemory(cwd),calls=[];let session,reads=0;
 async function open(){
  const loader=new pi.DefaultResourceLoader({cwd,agentDir:cwd,noExtensions:true,noSkills:true,noContextFiles:true,noPromptTemplates:true,noThemes:true});await loader.reload();
  ({session}=await pi.createAgentSession({cwd,modelRuntime:runtime,model:runtime.getModel('fake','fake'),resourceLoader:loader,sessionManager:manager,settingsManager:pi.SettingsManager.inMemory({compaction:{enabled:false}}),tools:['read','bash','edit','write']}));
  session.agent.streamFunction=(_model,context)=>{
   calls.push(JSON.stringify(context.messages));
   const text=context.messages.flatMap(message=>Array.isArray(message.content)?message.content:[]).find(block=>block.type==='text'&&block.text.startsWith('用户附件 ')).text;
   const stored=JSON.parse(text.split('\n')[0].slice('用户附件 '.length));
   const requestRead=context.messages.at(-1).role!=='toolResult';if(requestRead)reads++;
   const message={role:'assistant',content:requestRead?[{type:'toolCall',id:'attachment-read-'+reads,name:'read',arguments:{path:stored.readPath}}]:[{type:'text',text:'done'}],api:'openai-completions',provider:'fake',model:'fake',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:requestRead?'toolUse':'stop',timestamp:Date.now()};
   const stream=ai.createAssistantMessageEventStream();stream.push({type:'done',reason:message.stopReason,message});stream.end();return stream;
  };
 }
 try{
  await open();await appendMessageReferences(session,parseMessageReferences([{name:'notes.md',data:Buffer.from('STORED_FILE_CONTENT_ONLY_VIA_TOOL').toString('base64')}]),'first',storage);
  await session.prompt('请分析附件',{expandPromptTemplates:false});await session.waitForIdle();session.dispose();
  assert.doesNotMatch(calls[0],/STORED_FILE_CONTENT_ONLY_VIA_TOOL|U1RPUkVEX0ZJTEVfQ09OVEVOVF9PTkxZX1ZJQV9UT09M/);assert.match(calls[0],/readPath/);assert.match(calls[1],/STORED_FILE_CONTENT_ONLY_VIA_TOOL/);
  await open();await session.prompt('继续读取上一个附件',{expandPromptTemplates:false});await session.waitForIdle();
  assert.equal(reads,2);assert.equal(calls.length,4);assert.match(calls[3],/STORED_FILE_CONTENT_ONLY_VIA_TOOL/);
  assert.equal(session.messages.filter(message=>message.role==='toolResult'&&message.toolName==='read').length,2);
 }finally{session?.dispose();fs.rmSync(root,{recursive:true,force:true});}
});
