require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {projectTranscriptEntries}=require('../src/infrastructure/pi/transcript-projection.ts');

test('reference filenames and contents are not projected, including old history',()=>{
 const entries=[{id:'ref',type:'custom_message',customType:'user_reference_files',timestamp:'t',details:{names:['note.txt','image.png']},content:'private text'},{id:'u',parentId:'ref',type:'message',timestamp:'t',message:{role:'user',content:'hello'}},{id:'orphan',type:'custom_message',customType:'user_reference_files',timestamp:'t',details:{names:['stale.txt']}},{id:'barrier',parentId:'orphan',type:'custom',customType:'user_reference_boundary',timestamp:'t'},{id:'next',parentId:'barrier',type:'message',timestamp:'t',message:{role:'user',content:'next'}},{id:'bad',type:'custom_message',customType:'user_reference_files',timestamp:'t',details:{names:['/absolute/secret']}},{id:'last',parentId:'bad',type:'message',timestamp:'t',message:{role:'user',content:'last'}}];
 const result=projectTranscriptEntries(entries,{workingDirectory:'/tmp'});assert.equal(result[0].referenceNames,undefined);assert.equal(result[1].referenceNames,undefined);assert.equal(result[2].referenceNames,undefined);assert.equal(JSON.stringify(result).includes('private text'),false);
});
test('real in-memory Pi branch does not project reference files',async()=>{
 const {SessionManager}=await import('@earendil-works/pi-coding-agent');const {appendMessageReferences}=require('../src/infrastructure/pi/message-references.server.ts');const manager=SessionManager.inMemory('/tmp');const session={sessionManager:manager,sendCustomMessage:async m=>manager.appendCustomMessageEntry(m.customType,m.content,m.display,m.details)};
 await appendMessageReferences(session,[{type:'text',text:'secret body',referenceName:'note.txt'}],'turn-one');manager.appendMessage({role:'user',content:[{type:'text',text:'first'}],timestamp:Date.now()});await appendMessageReferences(session,[{type:'text',text:'orphan',referenceName:'orphan.txt'}],'turn-two');await appendMessageReferences(session);manager.appendMessage({role:'user',content:[{type:'text',text:'second'}],timestamp:Date.now()});const result=projectTranscriptEntries(manager.getBranch(),{workingDirectory:'/tmp'});assert.deepEqual(result.map(m=>m.referenceNames),[undefined,undefined]);assert.equal(JSON.stringify(result).includes('secret body'),false);
});
test('tool results stay at their transcript time instead of nesting under assistant text',()=>{
  const projected=projectTranscriptEntries([
    {id:'user',type:'message',timestamp:'2026-07-15T00:00:00.000Z',message:{role:'user',content:'先看文件'}},
    {id:'assistant',type:'message',timestamp:'2026-07-15T00:00:01.000Z',message:{role:'assistant',content:[{type:'text',text:'我先读取'},{type:'toolCall',id:'call-1',name:'project_read',arguments:{path:'README.md'}}]}},
    {id:'result',type:'message',timestamp:'2026-07-15T00:00:02.000Z',message:{role:'toolResult',toolCallId:'call-1',toolName:'project_read',isError:false,content:[{type:'text',text:'secret output'}]}},
    {id:'after',type:'message',timestamp:'2026-07-15T00:00:03.000Z',message:{role:'assistant',content:[{type:'text',text:'读取完成'}]}},
  ],{workingDirectory:'/tmp/project'});
  assert.deepEqual(projected.map(item=>item.id),['user','assistant','result','after']);
  assert.equal(projected[1].content,'我先读取');
  assert.equal(projected[1].entries,undefined);
  assert.equal(projected[2].entries[0].kind,'tool');
  assert.equal(projected[2].entries[0].activity.summary,'project_read');
  assert.equal(projected[2].entries[0].activity.detail,'目标：README.md');
  assert.equal(JSON.stringify(projected).includes('secret output'),false);
  assert.equal(JSON.stringify(projected).includes('读取文件'),false);
});
