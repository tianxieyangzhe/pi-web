require('./register.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createNativeContextService}=require('../src/application/native-context-service.ts');
const {emptyInspection}=require('../src/domain/native-context.ts');
const {sessionLocks}=require('../src/application/session-lock.ts');

function fixture(id){
  const session={id,projectId:'p',sessionMemoryId:'m',state:'idle',nativeRef:{kind:'pi'}};
  const project={id:'p',rootPath:'/tmp',status:'active'};
  const handle={};let finish,reject;let cancels=0,compacts=0,restores=0;
  const task=new Promise((resolve,rejectTask)=>{finish=resolve;reject=rejectTask;});
  const runtime={
    async inspect(){return {...emptyInspection(''),runtimeReady:true,canCompact:true};},
    getHandle(){return handle;},
    async restore(){restores++;return handle;},
    compact(value){assert.equal(value,handle);compacts++;return task;},
    cancelCompaction(value){assert.equal(value,handle);cancels++;},
  };
  const service=createNativeContextService({sessions:{get:()=>session},projects:{get:()=>project},runtime,assertWritable(){}});
  return {service,session,project,finish,reject,counts:()=>({cancels,compacts,restores})};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('Pi context reads are independent of memory summarization and do not execute work',async()=>{
  const f=fixture('pi-read');const result=await f.service.inspect('p','pi-read');
  assert.equal(result.sessionState,'idle');assert.equal(result.runtimeReady,true);
  assert.deepEqual(f.counts(),{cancels:0,compacts:0,restores:0});
  await assert.rejects(f.service.inspect('other','pi-read'),error=>error.code==='NOT_FOUND');
});
test('cancel calls Pi native cancellation and holds Session lock until compaction settles',async()=>{
  const f=fixture('pi-cancel');await f.service.compact('p','pi-cancel');
  assert(sessionLocks.has('pi-cancel'));
  const pending=await f.service.cancel('p','pi-cancel');
  assert.equal(pending.compactionState,'running');assert.equal(pending.canCancelCompaction,false);
  assert.equal(f.counts().cancels,1);assert(sessionLocks.has('pi-cancel'));
  await assert.rejects(f.service.compact('p','pi-cancel'),error=>error.code==='SESSION_BUSY');
  f.reject(new Error('Compaction cancelled'));await settle();
  assert(!sessionLocks.has('pi-cancel'));
  const done=await f.service.inspect('p','pi-cancel');
  assert.equal(done.compactionState,'cancelled');assert.equal(done.error,null);
  assert.equal(f.session.state,'idle');assert.equal(f.session.sessionMemoryId,'m');
});
test('completion winning cancellation race is shown as completed rather than cancelled',async()=>{
  const f=fixture('pi-race');await f.service.compact('p','pi-race');
  await f.service.cancel('p','pi-race');f.finish();await settle();
  assert.equal((await f.service.inspect('p','pi-race')).compactionState,'idle');
  await assert.rejects(f.service.cancel('p','pi-race'),error=>error.code==='COMPACTION_NOT_RUNNING');
});
test('readonly projects cannot cancel an active Pi operation',async()=>{
  const f=fixture('pi-readonly');await f.service.compact('p','pi-readonly');f.project.status='disabled';
  await assert.rejects(f.service.cancel('p','pi-readonly'),error=>error.code==='PROJECT_UNAVAILABLE');
  assert.equal(f.counts().cancels,0);f.finish();await settle();assert(!sessionLocks.has('pi-readonly'));
});
