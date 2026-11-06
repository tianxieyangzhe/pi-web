require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSessionExecutionService } = require('../src/application/session-execution-service.ts');
const { DomainError } = require('../src/domain/errors.ts');

const snapshot = { agentId:'agent', revision:1, kind:'project', projectId:null, contentSha256:'a'.repeat(64), name:'role', description:null, definition:{ instructions:'role', capabilities:{ readFiles:false, writeFiles:false } } };
function fixture(agentId, agentSnapshot, agent = null) {
  let value = { id:`optional-${agentId ?? 'none'}`, projectId:'p', state:'idle', agentId, agentSnapshot, mcpIds:[], nativeRef:null };
  const calls = [], handle = {};let activeHandle;
  const service = createSessionExecutionService({
    sessions:{ get:()=>value,setNativeRefIfAbsent:(_,ref)=>(value={...value,nativeRef:ref}), updateRuntime:(_,patch)=>(value={...value,...patch}) },
    catalog:{ getAgent:(id)=>{ calls.push(['catalog',id]); if(agent instanceof Error) throw agent; return agent; } },
    projects:{ get:()=>({ rootPath:'/tmp', status:'active' }) },
    runtime:{ getHandle:()=>activeHandle, initializeProject:async(input,commit)=>{calls.push(['open',input]);commit({kind:'pi'});activeHandle=handle;return handle;},close:async()=>{activeHandle=undefined;}, send:async(_,text)=>{ calls.push(['send',text]); } },
  });
  return {service,calls};
}
for (const [label, id, role, agent] of [
  ['no role', null, null, null],
  ['historical role ID only', 'old-id', null, null],
  ['legacy snapshot', 'old-id', {id:'old-id',name:'old',revision:1,extension:{},policy:{}}, null],
  ['archived role', 'agent', snapshot, {...snapshot,id:'agent',status:'archived'}],
  ['missing role', 'agent', snapshot, null],
  ['invalid role file', 'agent', snapshot, new DomainError('ROLE_FILE_MISSING','missing',409,true)],
  ['active role without capabilities', 'agent', snapshot, {...snapshot,id:'agent',status:'active'}],
]) {
  test(`${label} can send with independent project tools`, async()=>{
    const {service,calls}=fixture(id,role,agent), events=[];
    await service.open(`optional-${id ?? 'none'}`,'open');
    for await (const event of service.send(`optional-${id ?? 'none'}`,'hello')) events.push(event);
    const input=calls.find(c=>c[0]==='open')[1];
    assert.equal(input.allowProjectRead,true);
    assert.equal(input.allowProjectWrite,true);
    assert.equal(input.nativeCodingTools,true);
    assert.equal(input.session.agentSnapshot, label==='active role without capabilities' ? snapshot : null);
    assert.deepEqual(calls.find(c=>c[0]==='send'),['send','hello']);
    assert.ok(events.some(e=>e.type==='complete'));
  });
}
