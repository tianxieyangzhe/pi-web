require('./register.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createNativeContextService}=require('../src/application/native-context-service.ts');
const {emptyInspection}=require('../src/domain/native-context.ts');
const {DomainError}=require('../src/domain/errors.ts');
const {sessionLocks}=require('../src/application/session-lock.ts');

function fixture(id){
  const session={id,projectId:'p',state:'idle',nativeRef:{kind:'pi'}};
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
  const changes=[];const service=createNativeContextService({changed:id=>{assert(!sessionLocks.has(id));changes.push(id);},sessions:{get:()=>session},projects:{get:()=>project},runtime,assertWritable(){}});
  return {service,session,project,finish,reject,changes,counts:()=>({cancels,compacts,restores})};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('Pi context reads are read-only and do not execute work',async()=>{
  const f=fixture('pi-read');const result=await f.service.inspect('p','pi-read');
  assert.equal(result.sessionState,'idle');assert.equal(result.runtimeReady,true);
  assert.deepEqual(f.counts(),{cancels:0,compacts:0,restores:0});
  await assert.rejects(f.service.inspect('other','pi-read'),error=>error.code==='NOT_FOUND');
});
test('cancel calls Pi native cancellation and holds Session lock until compaction settles',async()=>{
  const f=fixture('pi-cancel');await f.service.compact('p','pi-cancel','compact');
  assert(sessionLocks.has('pi-cancel'));
  const pending=await f.service.cancel('p','pi-cancel','cancel');
  assert.equal(pending.inspection.compactionState,'running');assert.equal(pending.inspection.canCancelCompaction,false);
  assert.equal(f.counts().cancels,1);assert(sessionLocks.has('pi-cancel'));
  await assert.rejects(f.service.compact('p','pi-cancel','compact'),error=>error.code==='SESSION_BUSY');
  f.reject(new DomainError('REQUEST_ABORTED','Compaction cancelled',409,true));await settle();
  assert(!sessionLocks.has('pi-cancel'));
  const done=await f.service.inspect('p','pi-cancel');
  assert.equal(done.compactionState,'cancelled');assert.equal(done.error,null);
  assert.equal(f.session.state,'idle');assert.deepEqual(f.changes,['pi-cancel']);
});
test('completion winning cancellation race is shown as completed rather than cancelled',async()=>{
  const f=fixture('pi-race');await f.service.compact('p','pi-race','compact');
  await f.service.cancel('p','pi-race','cancel');f.finish();await settle();
  assert.equal((await f.service.inspect('p','pi-race')).compactionState,'idle');
  await assert.rejects(f.service.cancel('p','pi-race','cancel'),error=>error.code==='COMPACTION_NOT_RUNNING');
});
test('a started Pi operation can still settle safely after its project is disabled',async()=>{
  const f=fixture('pi-readonly');await f.service.compact('p','pi-readonly','compact');f.project.status='disabled';
  await f.service.cancel('p','pi-readonly','cancel');
  assert.equal(f.counts().cancels,1);f.finish();await settle();assert(!sessionLocks.has('pi-readonly'));
});
