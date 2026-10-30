require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {botModelFailure,botMessageEntries,assertSafeReceivedTranscript}=require('../src/infrastructure/pi/bot-runtime-failure.ts');
test('model errors expose a fixed actionable reason without provider payload or credentials',()=>{
 const error=botModelFailure('503: {"code":"model_not_found","message":"No available channel for model private-model","secret":"sk-private"}');
 assert.equal(error.code,'BOT_MODEL_UNAVAILABLE');assert(error.message.includes('OPENAI_MODEL_ID'));
 assert(!error.message.includes('private-model'));assert(!error.message.includes('sk-private'));
 assert.equal(botModelFailure('401 invalid_api_key sk-private').code,'BOT_MODEL_AUTH_FAILED');
 assert.equal(botModelFailure('unrecognized private error').code,'BOT_RUNTIME_FAILED');
});
test('failure delivery evidence only uses user markers after the precise execution boundary',()=>{
 const entries=[{id:'old',type:'message',message:{role:'user',content:'[BOT_MESSAGE:previous]'}},{id:'start',type:'custom'},
 {id:'current',type:'message',message:{role:'user',content:[{type:'text',text:'work\n[BOT_MESSAGE:current]'}]}},
 {id:'assistant',type:'message',message:{role:'assistant',content:'[BOT_MESSAGE:forged]'}}];
 assert.deepEqual(botMessageEntries(entries,'start'),{current:'current'});
 assert.deepEqual(botMessageEntries(entries,'missing'),{});
});
test('received-input continuation requires the exact original entry and rejects tool effects or newer user inputs',()=>{
 const entries=[{id:'prior',type:'message',message:{role:'assistant',content:'之前的上下文'}},{id:'start',type:'custom',customType:'bot_execution_start',data:{executionId:'failed',startId:'prior'}},{id:'input',type:'message',message:{role:'user',content:'请求\n[BOT_MESSAGE:source]'}}];
 assert.doesNotThrow(()=>assertSafeReceivedTranscript(entries,'failed','source','input'));
 const resumed=[...entries,{id:'resume-start',type:'custom',customType:'bot_execution_start',data:{executionId:'resume-1',startId:'input',inputMode:'resume_received',triggerMessageId:'source',inputNativeEntryId:'input'}}];
 assert.doesNotThrow(()=>assertSafeReceivedTranscript(resumed,'resume-1','source','input'));
 assert.throws(()=>assertSafeReceivedTranscript([...entries,{id:'tool-call',type:'message',message:{role:'assistant',content:[{type:'toolCall',id:'call',name:'project_write',arguments:{}}]}}],'failed','source','input'),error=>error.code==='RESUME_UNSUPPORTED');
 assert.throws(()=>assertSafeReceivedTranscript([...entries,{id:'next-input',type:'message',message:{role:'user',content:'后续消息'}}],'failed','source','input'),error=>error.code==='RESUME_UNSUPPORTED');
 assert.throws(()=>assertSafeReceivedTranscript(entries,'failed','source','wrong-entry'),error=>error.code==='RESUME_UNSUPPORTED');
});
