require('./register.cjs');
const {test}=require('node:test');const assert=require('node:assert/strict');
const {createProjectSessionService}=require('../src/application/project-session-service.ts');
test('session label projection uses confirmed memory only and reflects later saves',()=>{
 const session={id:'s',projectId:'p',sessionMemoryId:'r',sessionMemoryId:'r',purpose:'old purpose',state:'idle',createdAt:'',lastActivityAt:null,endedAt:null,agentSnapshot:null,mcpSnapshots:[]};
 const memory={projectId:'p',contextJson:{summary:''},draftJson:{context:{summary:'unconfirmed'}}};
 const service=createProjectSessionService({projects:{get:()=>({id:'p',status:'active'})},sessions:{listForProject:()=>[session]},memories:{get:()=>memory}});
 assert.equal(service.list('p')[0].memorySummary,'');
 memory.contextJson.summary='Confirmed summary';assert.equal(service.list('p')[0].memorySummary,'Confirmed summary');assert.equal(session.purpose,'old purpose');
});
