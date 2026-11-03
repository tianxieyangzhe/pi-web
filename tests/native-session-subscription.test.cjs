require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {subscribeNativeSession}=require('../src/infrastructure/pi/native-session-events.server.ts');
test('already appended custom message links synchronously by native object identity',async()=>{
 let listener;const received=[],content=[{type:'image',data:'bytes',mimeType:'image/png'}],details={referenceTurnId:'turn'};
 const entries=[{type:'custom_message',id:'reference',customType:'user_reference_files',content,details}];
 const close=subscribeNativeSession({subscribe:fn=>{listener=fn;return()=>{};}},{getEntries:()=>entries},event=>received.push(event));
 try {
  const message={role:'custom',customType:'user_reference_files',content,details};listener({type:'message_start',message});listener({type:'message_end',message});
  const start=received[0];assert.equal(received.at(-1).type,'entry_link');assert.equal(received.at(-1).entryId,'reference');assert.equal(received.at(-1).temporaryId,start.temporaryId);
  const count=received.filter(e=>e.type==='entry_link').length;
  const copy={...message,content:structuredClone(content),details:structuredClone(details)};listener({type:'message_start',message:copy});listener({type:'message_end',message:copy});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(received.filter(e=>e.type==='entry_link').length,count);
 }finally{close();}
});
test('installed Pi sendCustomMessage emits a reliable entry link before prompt or another run',async()=>{
 const pi=await import('@earendil-works/pi-coding-agent');
 const manager=pi.SessionManager.inMemory('/tmp');
 const loader=new pi.DefaultResourceLoader({cwd:'/tmp',agentDir:'/tmp',noExtensions:true,noSkills:true,noContextFiles:true,noPromptTemplates:true,noThemes:true});await loader.reload();
 const model={id:'test',name:'Test',provider:'test',api:'openai-completions',baseUrl:'https://example.invalid',reasoning:false,input:['text','image'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:1024};
 const {session}=await pi.createAgentSession({cwd:'/tmp',agentDir:'/tmp',sessionManager:manager,resourceLoader:loader,model,modelRuntime:{getModel:()=>model,getPhysicalModel:()=>model},settingsManager:pi.SettingsManager.inMemory({compaction:{enabled:false}}),noTools:'all'});
 const events=[],close=subscribeNativeSession(session,manager,event=>events.push(event));
 try {
  await session.sendCustomMessage({customType:'user_reference_files',display:false,details:{referenceTurnId:'real'},content:[{type:'text',text:'reference'}]});
  const link=events.find(e=>e.type==='entry_link');assert.ok(link);assert.equal(manager.getEntry(link.entryId).type,'custom_message');assert.equal(link.temporaryId,events.find(e=>e.piType==='message_start').temporaryId);
  assert.equal(events.filter(e=>e.type==='entry_link').length,1);
 }finally{close();session.dispose();}
});
test('native subscription links only actual appended messages and correlates tool progress by toolCallId',async()=>{
 let listener,unsubscribed=false;const entries=[],received=[];
 const close=subscribeNativeSession({subscribe:fn=>{listener=fn;return()=>{unsubscribed=true;};}},{getEntries:()=>entries},event=>received.push(event));
 try{
  listener({type:'tool_execution_start',toolCallId:'call',toolName:'bash',args:{password:'secret'}});
  listener({type:'tool_execution_update',toolCallId:'call',partialResult:{text:'raw output'}});
  const message={role:'toolResult',toolCallId:'call',content:[{type:'text',text:'done'}]};
  listener({type:'message_start',message});listener({type:'message_end',message});
  assert.equal(received.some(e=>e.type==='entry_link'),false);entries.push({type:'message',id:'entry',message});await new Promise(resolve=>setImmediate(resolve));
  const native=received.filter(e=>e.type==='pi_event'),links=received.filter(e=>e.type==='entry_link');
  assert.equal(native[0].temporaryId,native[1].temporaryId);assert.equal(native[0].payload.args.password,'secret');assert.equal(links.length,2);assert.ok(links.every(e=>e.entryId==='entry'));
  assert.ok(links.some(e=>e.temporaryId===native[0].temporaryId));
  const unmatched={role:'assistant',content:[{type:'text',text:'done'}]};listener({type:'message_start',message:unmatched});listener({type:'message_end',message:unmatched});await new Promise(resolve=>setImmediate(resolve));assert.equal(received.filter(e=>e.type==='entry_link').length,2);
 }finally{close();}assert.equal(unsubscribed,true);
});
