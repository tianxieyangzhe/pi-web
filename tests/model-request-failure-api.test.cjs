require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
const Database=require('better-sqlite3');
const {DomainError}=require('../src/domain/errors.ts');
const {createSessionExecutionService}=require('../src/application/session-execution-service.ts');
const {createSessionToolsService}=require('../src/application/session-tools-service.ts');
const {createProjectOperationStore}=require('../src/infrastructure/projects/operation-journal.server.ts');
const {sessionLocks}=require('../src/application/session-lock.ts');
const tick=()=>new Promise(setImmediate);
async function fixture(){
 const pi=await import('@earendil-works/pi-coding-agent'),ai=await import('@earendil-works/pi-ai'),load=Module._load;
 Module._load=function(spec,...args){return spec==='@earendil-works/pi-coding-agent'?pi:spec==='@earendil-works/pi-ai'?ai:load.call(this,spec,...args);};
 let PiSessionRuntime,initializeSession;
 try{({PiSessionRuntime}=require('../src/infrastructure/pi/pi-session-runtime.server.ts'));({initializeSession}=require('./support/initialize-pi-session.ts'));}finally{Module._load=load;}
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'model-failure-api-'))),db=new Database(':memory:');
 db.exec('CREATE TABLE sessions(id TEXT PRIMARY KEY,value TEXT NOT NULL)');
 const manager=initializeSession('model-failure',root,root),ref={kind:'pi',sessionId:manager.getSessionId(),sessionFile:manager.getSessionFile(),cwd:root};
 db.prepare('INSERT INTO sessions VALUES (?,?)').run('s',JSON.stringify({id:'s',projectId:'p',purpose:'Keep session',agentId:null,agentSnapshot:null,mcpIds:[],state:'idle',nativeRef:ref}));
 const sessions={get(id){const row=db.prepare('SELECT value FROM sessions WHERE id=?').get(id);return row?JSON.parse(row.value):null;},updateRuntime(id,patch){const value={...this.get(id),...patch};db.prepare('UPDATE sessions SET value=? WHERE id=?').run(JSON.stringify(value),id);return value;}};
 const modelRuntime=await pi.ModelRuntime.create({credentials:{async read(){},async list(){return [];},async modify(){},async delete(){}},modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
 modelRuntime.registerProvider('controlled',{baseUrl:'http://localhost',apiKey:'fake',api:'openai-completions',models:['bad','good'].map(id=>({id,name:id,reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1000}))});
 let available=true,blockedModel=null,streamCalls=0,errorText='API error (404): no route available for the requested model';
 const runtime=new PiSessionRuntime(async()=>({runtime:modelRuntime,defaults:{provider:'controlled',modelId:'bad'},models:available?modelRuntime.getModels().filter(model=>model.id!==blockedModel):[],configuration:{models:'native',settings:'native'}}));
 const projects={get:()=>({id:'p',name:'Project',status:'active',rootPath:root})},execution=createSessionExecutionService({sessions,projects,catalog:{getAgent:()=>null},runtime});
 const operations=createProjectOperationStore(root),tools=createSessionToolsService({sessions,projects,runtime,execution,operations,assertWritable(){},present:value=>value,catalog:{}});
 const opened=await tools.open('p','s','open'),lease=opened.leaseId;
 runtime.getHandle('s').session.agent.streamFunction=(model)=>{
  streamCalls++;const stream=ai.createAssistantMessageEventStream(),message={role:'assistant',content:errorText?[]:[{type:'text',text:'ok'}],api:model.api,provider:model.provider,model:model.id,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:errorText?'error':'stop',errorMessage:errorText||undefined,timestamp:Date.now()};
  stream.push(errorText?{type:'error',reason:'error',error:message}:{type:'done',reason:'stop',message});stream.end();return stream;
 };
 async function settled(operationId){for(let i=0;i<100&&tools.running(operationId);i++)await tick();assert.equal(tools.running(operationId),false);return operations.read('p',operationId).at(-1);}
 return {root,db,ref,sessions,runtime,execution,operations,tools,lease,settled,pi,get streamCalls(){return streamCalls;},setAvailable:value=>{available=value;},blockModel:id=>{blockedModel=id;},setError:value=>{errorText=value;},async close(){execution.close('s',lease);const h=runtime.getHandle('s');if(h)await runtime.close(h);sessionLocks.delete('s');db.close();fs.rmSync(root,{recursive:true,force:true});}};
}
test('message and model APIs settle a real controlled Pi provider rejection and permit changing models with the original lease',async()=>{
 const f=await fixture();
 try{
  const before=fs.readFileSync(f.ref.sessionFile,'utf8'),body={content:'Original message'};
  const accepted=f.tools.accept('p','s',body,'bad-request',f.lease),record=await f.settled(accepted.operationId);
  assert.equal(record.phase,'failed');assert.equal(record.evidence.errorCode,'MODEL_REQUEST_FAILED');assert.equal(record.evidence.settled,true);assert.equal(f.sessions.get('s').state,'idle');assert.equal(f.streamCalls,1);
  const history=fs.readFileSync(f.ref.sessionFile,'utf8');assert(history.startsWith(before));assert(history.includes('no route available for the requested model'));
  assert.throws(()=>f.tools.accept('p','s',body,'bad-request',f.lease),e=>e.code==='MODEL_REQUEST_FAILED');assert.equal(f.streamCalls,1);
  assert.equal((await f.tools.models('p','s',f.lease)).canSwitch,true);
  const switched=await f.tools.switchModel('p','s',{provider:'controlled',modelId:'good'},'change',f.lease);
  assert.equal(switched.current.modelId,'good');assert.equal(switched.canSwitch,true);assert.equal(switched.unavailableReason,null);
  const repeated=await f.tools.switchModel('p','s',{provider:'controlled',modelId:'good'},'change',f.lease);
  assert.equal(repeated.canSwitch,true);assert.equal(repeated.current.modelId,'good');
  const thinking=await f.tools.switchModel('p','s',{provider:'controlled',modelId:'good',thinkingLevel:'off'},'thinking',f.lease);
  assert.equal(thinking.canSwitch,true);assert.equal(thinking.thinkingLevel,'off');assert.equal(thinking.current.modelId,'good');
  assert.equal((await f.tools.models('p','s',f.lease)).current.modelId,'good');assert.deepEqual(f.sessions.get('s').nativeRef,f.ref);assert(fs.readFileSync(f.ref.sessionFile,'utf8').startsWith(history));
  f.setError('');const next=f.tools.accept('p','s',{content:'New user intent'},'new-request',f.lease);assert.equal((await f.settled(next.operationId)).phase,'completed');assert.equal(f.streamCalls,2);
 }finally{await f.close();}
});
test('message and restore APIs classify definite preflight model failure without inventing pending requests',async()=>{
 const f=await fixture();
 try{
  const bytes=fs.readFileSync(f.ref.sessionFile);f.setAvailable(false);
  const accepted=f.tools.accept('p','s',{content:'Config removed'},'preflight',f.lease),record=await f.settled(accepted.operationId);
  assert.equal(record.phase,'failed');assert.equal(record.evidence.notStarted,true);assert.equal(record.evidence.errorCode,'MODEL_UNAVAILABLE');assert.equal(f.streamCalls,0);assert.deepEqual(fs.readFileSync(f.ref.sessionFile),bytes);assert.equal((await f.tools.models('p','s',f.lease)).canSwitch,true);
  f.setAvailable(true);await assert.rejects(f.tools.restore('p','s','unneeded-restore'),e=>e.code==='SESSION_NOT_UNAVAILABLE');assert.equal(f.operations.list('p','s').at(-1).phase==='prepared',false);
  assert.equal((await f.tools.models('p','s',f.lease)).canSwitch,true);
  f.setError('');const next=f.tools.accept('p','s',{content:'New intent'},'after-preflight',f.lease);assert.equal((await f.settled(next.operationId)).phase,'completed');
  const saved=fs.readFileSync(f.ref.sessionFile);f.setAvailable(false);f.sessions.updateRuntime('s',{state:'unavailable'});
  await assert.rejects(f.tools.restore('p','s','model-unavailable-restore'),e=>e.code==='MODEL_UNAVAILABLE');
  assert.equal(f.operations.list('p','s').find(record=>record.operation==='restore'&&record.evidence.errorCode==='MODEL_UNAVAILABLE').phase,'failed');assert.deepEqual(fs.readFileSync(f.ref.sessionFile),saved);
  f.setAvailable(true);assert.equal((await f.tools.models('p','s',f.lease)).canSwitch,true);await f.tools.switchModel('p','s',{provider:'controlled',modelId:'good'},'recover-model',f.lease);assert.deepEqual(f.sessions.get('s').nativeRef,f.ref);
 }finally{await f.close();}
});
test('true unknown still blocks model and restore APIs; historical recovery is read-only until an explicit acknowledgement',async()=>{
 const f=await fixture();
 try{
  f.runtime.send=async()=>{throw new DomainError('RUNTIME_ERROR','Unconfirmed connection failure',503,true);};
  const accepted=f.tools.accept('p','s',{content:'Unknown'},'unknown',f.lease),record=await f.settled(accepted.operationId);assert.equal(record.phase,'prepared');assert.equal(f.sessions.get('s').state,'unavailable');
  assert.equal((await f.tools.models('p','s',f.lease)).unavailableReason,'REQUEST_UNKNOWN');
  assert.throws(()=>f.tools.switchModel('p','s',{provider:'controlled',modelId:'good'},'blocked',f.lease),e=>e.code==='REQUEST_UNKNOWN');assert.throws(()=>f.tools.restore('p','s','blocked-restore'),e=>e.code==='REQUEST_UNKNOWN');
  const native=fs.readFileSync(f.ref.sessionFile),count=f.operations.read('p',record.operationId).length;
  const inspected=await f.tools.recover('p','s',{operationId:record.operationId,action:'inspect'});assert.equal(inspected.status,'unknown');assert.equal(inspected.allowedRecovery.acknowledgeUnknown,true);assert.equal(f.operations.read('p',record.operationId).length,count);
  const result=await f.tools.recover('p','s',{operationId:record.operationId,action:'acknowledge-unknown'},'explicit-ack');assert.equal(result.status,'acknowledged');assert.deepEqual(fs.readFileSync(f.ref.sessionFile),native);assert.equal(f.streamCalls,0);
  assert.throws(()=>f.tools.accept('p','s',{content:'Unknown'},'unknown',f.lease),e=>e.code==='REQUEST_UNKNOWN');assert.equal((await f.tools.models('p','s',f.lease)).canSwitch,true);
  await f.tools.switchModel('p','s',{provider:'controlled',modelId:'good'},'after-ack',f.lease);assert.equal((await f.tools.models('p','s',f.lease)).current.modelId,'good');assert.equal(f.streamCalls,0);
 }finally{await f.close();}
});
test('message API rejects an unavailable saved model without using the valid application default',async()=>{
 const f=await fixture();
 try{
  await f.tools.switchModel('p','s',{provider:'controlled',modelId:'good'},'select-good',f.lease);
  const before=fs.readFileSync(f.ref.sessionFile),handle=f.runtime.getHandle('s');f.blockModel('good');
  const accepted=f.tools.accept('p','s',{content:'Do not fall back'},'blocked-current',f.lease),record=await f.settled(accepted.operationId);
  assert.equal(record.phase,'failed');assert.equal(record.evidence.errorCode,'MODEL_UNAVAILABLE');assert.equal(f.streamCalls,0);
  assert.equal(handle.session.model.id,'good');assert.deepEqual(fs.readFileSync(f.ref.sessionFile),before);
  const view=await f.tools.models('p','s',f.lease);assert.equal(view.current.modelId,'good');assert.equal(view.current.available,false);assert.equal(view.canSwitch,true);assert(view.models.some(model=>model.modelId==='bad'&&model.available));
  const changed=await f.tools.switchModel('p','s',{provider:'controlled',modelId:'bad'},'explicit-recovery',f.lease);assert.equal(changed.current.modelId,'bad');assert.equal(changed.canSwitch,true);
  f.setError('');const next=f.tools.accept('p','s',{content:'Explicit new intent'},'after-explicit',f.lease);assert.equal((await f.settled(next.operationId)).phase,'completed');assert.equal(f.streamCalls,1);
 }finally{await f.close();}
});
test('message API retains unknown if the durable failure receipt cannot be written',async()=>{
 const f=await fixture();
 try{
  const append=f.operations.append.bind(f.operations);f.operations.append=(record,phase,evidence)=>{if(phase==='failed')throw Error('Controlled receipt failure');return append(record,phase,evidence);};
  const accepted=f.tools.accept('p','s',{content:'Rejected but missing receipt'},'receipt',f.lease);assert.equal((await f.settled(accepted.operationId)).phase,'observed');
  assert.equal((await f.tools.models('p','s',f.lease)).unavailableReason,'REQUEST_UNKNOWN');assert.throws(()=>f.tools.switchModel('p','s',{provider:'controlled',modelId:'good'},'blocked',f.lease),e=>e.code==='REQUEST_UNKNOWN');
 }finally{await f.close();}
});
