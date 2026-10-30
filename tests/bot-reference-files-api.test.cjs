require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const root=require.resolve('../src/bootstrap/composition-root.server.ts');let sends=0;
const bots={detail:()=>({}),send:()=>{sends++;return {accepted:true};},referenceContractVersion:2};
require.cache[root]={id:root,filename:root,loaded:true,exports:{services:{bots},listBotReferenceFiles:(b,c,p)=>({entries:[{name:`${b}-${c}-${p}`}]})}};
const {botApi}=require('../src/shared/protocol/bot-api.server.ts');
function request(refs){return new Request('http://localhost/api/bots/b/conversations/c/messages',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'k'},body:JSON.stringify({content:'hi',references:refs})});}
test('reference directory route does not depend on cached bot service',async()=>{const response=await botApi(new Request('http://localhost/api/bots/b/conversations/c/files?purpose=references&path=sub'),['b','conversations','c','files']);assert.equal(response.status,200);assert.equal((await response.json()).data.entries[0].name,'b-c-sub');});
test('stale message service rejects uploads',async()=>{const response=await botApi(request([{name:'x',data:'eA=='}]),['b','conversations','c','messages']);assert.equal(response.status,503);assert.equal((await response.json()).error.code,'REFERENCE_SERVICE_RESTART_REQUIRED');const normal=await botApi(request(undefined),['b','conversations','c','messages']);assert.equal(normal.status,503);assert.equal(sends,0);});
test('current reference contract permits uploads above the old JSON limit',async()=>{bots.referenceContractVersion=7;const response=await botApi(request([{name:'x',data:Buffer.alloc(150000,65).toString('base64')}]),['b','conversations','c','messages']);assert.equal(response.status,202);assert.equal(sends,1);});
