require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createProjectMessageTiming } = require('../src/application/project-message-timing.ts');
const { createSessionExecutionService } = require('../src/application/session-execution-service.ts');

test('timing uses monotonic elapsed milliseconds, logs each stage once and tolerates log failure',()=>{
  let time=100; const lines=[];
  const mark=createProjectMessageTiming('session-1',{now:()=>time,log:line=>lines.push(line)});
  mark('accepted');time=112.34;mark('first_text');mark('first_text');
  const data=lines.map(line=>JSON.parse(line.slice(line.indexOf('{'))));
  assert.deepEqual(data.map(item=>item.stage),['accepted','first_text']);
  assert.deepEqual(data.map(item=>item.elapsedMs),[0,12.3]);
  assert.equal(data[0].id,data[1].id);
  assert.doesNotThrow(()=>createProjectMessageTiming('s',{log:()=>{throw new Error('failed');}})('accepted'));
});

test('project send records runtime and first events without recording content',async()=>{
  const original=console.info, lines=[];
  console.info=(line)=>lines.push(line);
  let session={id:'timing-session',projectId:'p',sessionMemoryId:'m',state:'idle',agentId:null,agentSnapshot:null,mcpIds:[],nativeRef:null};
  const handle={};
  const service=createSessionExecutionService({
    sessions:{get:()=>session,updateRuntime:(_,patch)=>(session={...session,...patch})},
    catalog:{},projects:{get:()=>({rootPath:'/private/project',status:'active'})},sessionMemories:{get:()=>({projectId:'p'})},
    runtime:{getHandle:()=>handle,send:async(_handle,_message,emit,onAssistantStream)=>{onAssistantStream();onAssistantStream();emit({type:'message_delta',text:'private answer'});emit({type:'activity',kind:'tool',state:'running',summary:'private tool'});emit({type:'message_delta',text:'more'});}},
  });
  try {
    const events=[];
    for await (const event of service.send('timing-session','private prompt')) events.push(event);
    assert.ok(events.some(e=>e.type==='complete'));
    const entries=lines.map(line=>JSON.parse(line.slice(line.indexOf('{'))));
    assert.deepEqual(entries.map(e=>e.stage),['accepted','handle_reused','prompt_start','assistant_stream','first_text','first_tool','completed']);
    assert.ok(entries.every(e=>e.id===entries[0].id && e.sessionId==='timing-session'));
    assert.doesNotMatch(lines.join('\n'),/private|\/private/);
  } finally {console.info=original;}
});

test('failed runtime send records failure without error message',async()=>{
  const original=console.info,lines=[];console.info=line=>lines.push(line);
  let session={id:'timing-failure',projectId:'p',sessionMemoryId:'m',state:'idle',agentId:null,agentSnapshot:null,mcpIds:[],nativeRef:null};
  const service=createSessionExecutionService({sessions:{get:()=>session,updateRuntime:(_,patch)=>(session={...session,...patch})},catalog:{},projects:{get:()=>({rootPath:'/tmp',status:'active'})},sessionMemories:{get:()=>({projectId:'p'})},runtime:{getHandle:()=>({}),send:async()=>{throw new Error('sensitive failure');}}});
  try {
    const events=[];for await(const event of service.send('timing-failure','secret')) events.push(event);
    assert.ok(events.some(e=>e.type==='error'));
    assert.ok(lines.some(line=>line.includes('"stage":"failed"')));
    assert.doesNotMatch(lines.join('\n'),/secret|sensitive/);
  } finally {console.info=original;}
});
