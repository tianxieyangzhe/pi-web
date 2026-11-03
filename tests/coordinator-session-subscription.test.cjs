require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createBotService}=require('../src/application/bot-service.ts');
function fixture(){
 const caps={readFiles:false,writeFiles:false,readProjects:false,dispatchTasks:false,dispatchProjectWrites:false,exchangeMessages:false};
 const agent={id:'a',kind:'coordinator',status:'active',revision:1,contentSha256:'a'.repeat(64),name:'Coordinator',description:null,definition:{instructions:'role',capabilities:caps}};
 const snapshot={agentId:'a',kind:'coordinator',revision:1,contentSha256:agent.contentSha256,name:agent.name,description:null,botId:null,projectId:null,definition:agent.definition};let c={id:'c',botId:'b',coordinatorAgentId:'a',coordinatorAgentSnapshot:snapshot,nativeRef:null},opened=0,closed=0,nativeListener;
 const bot={id:'b',status:'active',workingDirectory:'/tmp',maxParallelExecutions:1};
 const repository={get:(table,id)=>table==='bots'?bot:c,conversationConfiguration:()=>[],projectCalls:()=>[],update:(_table,_id,patch)=>(c={...c,...patch})};
 const runtime={open:async(input,onRef)=>{opened++;await new Promise(resolve=>setImmediate(resolve));if(!input.nativeRef)onRef({kind:'pi',sessionFile:'/tmp/fake',sessionId:'native',cwd:'/tmp'});},subscribe:(_id,fn)=>{nativeListener=fn;return()=>{};},close:async()=>closed++,readTree:async()=>({entries:[],activeLeafId:null})};
 const service=createBotService({repository,workspace:{sessionDirectory:()=>'/tmp'},runtime,runtimeInstanceId:'test',sessions:{},projects:{},memories:{},catalog:{getAgent:()=>agent}});
 return {service,native:event=>nativeListener(event),stats:()=>({opened,closed}),conversation:()=>c};
}
test('coordinator opens once concurrently, retains native identity and grants independent subscriptions',async()=>{
 const f=fixture();const [a,b]=await Promise.all([f.service.open('b','c','key-a'),f.service.open('b','c','key-b')]);
 assert.equal(f.stats().opened,1);assert.equal(f.conversation().nativeRef.sessionId,'native');assert.notEqual(a.leaseId,b.leaseId);assert.deepEqual(await f.service.open('b','c','key-a'),a);
 const frames=[];const close=f.service.events.subscribe('c',a.leaseId,frame=>frames.push(frame),()=>{});
 f.native({type:'pi_event',piType:'agent_start',temporaryId:null,payload:{type:'agent_start'}});assert.ok(frames.some(frame=>frame.data?.type==='agent_start'));
 close();assert.equal(f.stats().closed,0);f.service.assertLease('b','c',b.leaseId);f.service.closeLease('b','c',b.leaseId);assert.equal(f.stats().closed,1);
});
