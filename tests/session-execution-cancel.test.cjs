require('./register.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createSessionExecutionService}=require('../src/application/session-execution-service.ts');
const {DomainError}=require('../src/domain/errors.ts');
const {sessionLocks}=require('../src/application/session-lock.ts');
const snapshot={agentId:'agent-cancel',revision:1,kind:'project',projectId:null,contentSha256:'a'.repeat(64),name:'role',description:null,definition:{instructions:'执行项目检查',capabilities:{readFiles:true,writeFiles:false}}};
const role={...snapshot,id:'agent-cancel',contentSha256:'a'.repeat(64),status:'active'};
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function fixture(runtime){
  let value={id:'session-cancel',projectId:'p',sessionMemoryId:'m',state:'idle',agentId:'agent-cancel',agentSnapshot:snapshot,mcpIds:[],nativeRef:null};
  const service=createSessionExecutionService({sessions:{get:()=>value,setNativeRefIfAbsent:(_,ref)=>(value={...value,nativeRef:ref}),updateRuntime:(_,patch)=>{value={...value,...patch};return value;}},catalog:{getAgent:()=>role},projects:{get:()=>({rootPath:'/tmp',status:'active'})},sessionMemories:{get:()=>({projectId:'p'})},runtime});
  return {service,get value(){return value;}};
}

test('opening excludes sends until the native identity is established',async()=>{
  const opening=deferred(),openCalled=deferred(),handle={},calls=[];let activeHandle;
  const runtime={getHandle:()=>activeHandle,initializeProject:async(_input,commit)=>{openCalled.resolve();await opening.promise;commit({kind:'pi',sessionId:'n',sessionFile:'/tmp/controlled.jsonl',cwd:'/tmp'});activeHandle=handle;return handle;},send:async()=>{calls.push('send');},close:async()=>{activeHandle=undefined;}};
  const f=fixture(runtime);assert.throws(()=>f.service.send('session-cancel','before open'),e=>e.code==='RUNTIME_NOT_OPEN');
  const pending=f.service.open('session-cancel','open');await openCalled.promise;
  assert.throws(()=>f.service.send('session-cancel','during open'),e=>e.code==='SESSION_BUSY');assert.equal(sessionLocks.has('session-cancel'),true);
  opening.resolve();const opened=await pending;assert.equal(opened.status,'ready');assert.equal(f.value.nativeRef.sessionId,'n');assert.equal(sessionLocks.has('session-cancel'),false);assert.deepEqual(calls,[]);
  await f.service.close('session-cancel');
});

test('stopping an active Pi request waits for runtime idle before releasing the Session',async()=>{
  const sent=deferred(),release=deferred(),interruptCalled=deferred(),nativeIdle=deferred(),handle={};let interruptCalls=0,stopSettled=false;
  const runtime={getHandle:()=>handle,close:async()=>{},open:async()=>({handle,nativeRef:{kind:'pi'}}),restore:async()=>handle,send:async()=>{sent.resolve();try{await release.promise;throw new DomainError('REQUEST_ABORTED','请求已停止',409,true);}finally{nativeIdle.resolve();}},interrupt:async()=>{interruptCalls++;interruptCalled.resolve();await nativeIdle.promise;}};
  const f=fixture(runtime),events=[];await f.service.open('session-cancel','open');
  const consuming=(async()=>{for await(const event of f.service.send('session-cancel','do work'))events.push(event);})();
  await sent.promise;
  const stopping=f.service.interrupt('session-cancel').then(()=>{stopSettled=true;});
  await interruptCalled.promise;
  assert.equal(f.value.state,'interrupting');
  assert.equal(stopSettled,false);
  assert.equal(sessionLocks.has('session-cancel'),true);
  release.resolve();
  await Promise.all([consuming,stopping]);
  assert.equal(interruptCalls,1);
  assert.equal(f.value.state,'idle');
  assert.equal(sessionLocks.has('session-cancel'),false);
  assert.ok(events.some(event=>event.type==='error'&&event.code==='REQUEST_ABORTED'));
});
