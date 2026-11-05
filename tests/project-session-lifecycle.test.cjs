require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createSessionExecutionService}=require('../src/application/session-execution-service.ts');
function fixture(){
 let value={id:'lifecycle',projectId:'p',state:'idle',agentId:null,agentSnapshot:null,mcpIds:[],nativeRef:null,endedAt:null};
 let handle,opens=0,sends=0,closed=0,writeAllowed;
 const runtime={getHandle:()=>handle,initializeProject:async(input,commit)=>{opens++;await new Promise(r=>setImmediate(r));commit({sessionId:'native'});handle={};return handle;},restore:async()=>{handle={};return handle;},send:async(_h,_text,_emit,_stream,_refs,allow)=>{sends++;writeAllowed=allow;},close:async()=>{closed++;handle=undefined;},readTree:async()=>({entries:[],activeLeafId:null})};
 const sessions={get:()=>value,setNativeRefIfAbsent:(_,ref)=>(value={...value,nativeRef:value.nativeRef??ref}),updateRuntime:(_,patch)=>(value={...value,...patch})};
 const service=createSessionExecutionService({sessions,catalog:{getAgent:()=>null},projects:{get:()=>({rootPath:'/tmp',status:'active'})},runtime,sessionMemories:{get:()=>({projectId:'p'})}});
 return {service,stats:()=>({opens,sends,closed,writeAllowed}),value:()=>value};
}
test('concurrent opens initialize once, leases are independent, send only reuses handle',async()=>{
 const {service,stats,value}=fixture();
 assert.throws(()=>service.send('lifecycle','before open'),e=>e.code==='RUNTIME_NOT_OPEN');
 const [a,b]=await Promise.all([service.open('lifecycle','a'),service.open('lifecycle','b')]);
 assert.notEqual(a.leaseId,b.leaseId);assert.equal(stats().opens,1);assert.equal(value().nativeRef.sessionId,'native');
 assert.deepEqual(await service.open('lifecycle','a'),a); service.assertLease('lifecycle',a.leaseId);
 const events=[];for await(const e of service.send('lifecycle','hello'))events.push(e);
 assert.ok(events.some(e=>e.type==='complete'));assert.equal(stats().sends,1);assert.equal(stats().opens,1);assert.equal(stats().writeAllowed,true);
 for await(const e of service.send('lifecycle','read only','read')) void e;
 assert.equal(stats().writeAllowed,false);
 service.closeLease('lifecycle',a.leaseId);assert.equal(stats().closed,0);service.closeLease('lifecycle',b.leaseId);assert.equal(stats().closed,1);
 assert.throws(()=>service.assertLease('lifecycle',a.leaseId),e=>e.code==='RUNTIME_NOT_OPEN');
});
