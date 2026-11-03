require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createSessionExecutionService}=require('../src/application/session-execution-service.ts');
test('accepted project execution survives observer disconnect and reuses the opened handle',async()=>{
 let value={id:'s-sub',projectId:'p',sessionMemoryId:'m',state:'idle',mcpIds:[],nativeRef:null},handle,complete,started=false,finished=false,closed=0;
 const wait=new Promise(resolve=>complete=resolve),nativeListeners=new Set();
 const runtime={getHandle:()=>handle,initializeProject:async(_input,commit)=>{commit({sessionId:'native'});return handle={};},subscribe:(_h,listener)=>{nativeListeners.add(listener);return()=>nativeListeners.delete(listener);},close:async()=>{closed++;handle=undefined;},send:async(_h,_content,emit)=>{started=true;for(const listener of nativeListeners)listener({type:'pi_event',piType:'agent_start',payload:{type:'agent_start'},temporaryId:null});await wait;emit({type:'message_delta',text:'done'});finished=true;}};
 const service=createSessionExecutionService({sessions:{get:()=>value,setNativeRefIfAbsent:(_,ref)=>(value={...value,nativeRef:ref}),updateRuntime:(_,patch)=>(value={...value,...patch})},catalog:{},projects:{get:()=>({status:'active',rootPath:'/tmp'})},runtime,sessionMemories:{get:()=>({projectId:'p'})}});
 const a=await service.open('s-sub','a'),b=await service.open('s-sub','b'),events=[];
 const closeA=service.events.subscribe('s-sub',a.leaseId,frame=>events.push(frame),()=>{}),closeB=service.events.subscribe('s-sub',b.leaseId,frame=>events.push(frame),()=>{});
 try{
  assert.equal(service.accept('s-sub','hello').accepted,true);await new Promise(resolve=>setImmediate(resolve));assert.equal(started,true);closeA();assert.equal(finished,false);assert.equal(closed,0);service.assertLease('s-sub',b.leaseId);
  complete();await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,true);assert.equal(value.state,'idle');assert.ok(events.some(frame=>frame.data?.type==='complete'));
 }finally{complete();closeA();closeB();}assert.equal(closed,1);
});
