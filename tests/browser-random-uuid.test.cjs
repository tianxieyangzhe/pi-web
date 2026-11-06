require('./register.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const {randomUUID}=require('../web/api/random-uuid.ts');
const uuidV4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function withCrypto(source,run){
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
 Object.defineProperty(globalThis,'crypto',{configurable:true,value:source});
 return Promise.resolve().then(run).finally(()=>{if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);else delete globalThis.crypto;});
}
test('uses native randomUUID with its crypto receiver',()=>withCrypto({randomUUID(){assert.equal(this,globalThis.crypto);return 'native-uuid';},getRandomValues(){throw Error('unexpected fallback');}},()=>{
 assert.equal(randomUUID(),'native-uuid');
}));
test('HTTP fallback uses secure random bytes and sets UUID v4 version and variant',()=>{
 let calls=0;
 return withCrypto({getRandomValues(bytes){calls++;assert.equal(bytes.length,16);bytes.fill(255);return bytes;}},()=>{
  assert.equal(randomUUID(),'ffffffff-ffff-4fff-bfff-ffffffffffff');assert.equal(calls,1);
 });
});
test('HTTP clients submit valid keys and preserve an explicit retry key',()=>withCrypto({getRandomValues:bytes=>webcrypto.getRandomValues(bytes)},async()=>{
 const {api}=require('../web/api/client.ts');
 const {workspaceApi}=require('../web/api/workspace-client.ts');
 const {submitSessionMessage}=require('../web/api/session-events.ts');
 const previousFetch=global.fetch,calls=[];
 global.fetch=async(url,init)=>{calls.push({url,headers:new Headers(init.headers)});return Response.json({data:{}});};
 try{
  await api.createProject({name:'Example',rootPath:'/example'});
  await workspaceApi.createSession('workspace');
  await submitSessionMessage('/session','lease','hello');
  await workspaceApi.save(null,{name:'Workspace',projects:[{rootPath:'/example'}],defaultProjectIndex:0},undefined,'retained-retry-key');
  for(const call of calls.slice(0,3))assert.match(call.headers.get('idempotency-key'),uuidV4);
  assert.equal(new Set(calls.slice(0,3).map(call=>call.headers.get('idempotency-key'))).size,3);
  assert.equal(calls[2].headers.get('x-session-lease-id'),'lease');
  assert.equal(calls[3].headers.get('idempotency-key'),'retained-retry-key');
 }finally{global.fetch=previousFetch;}
}));
test('missing secure randomness fails before sending a request',()=>withCrypto({},async()=>{
 const {api}=require('../web/api/client.ts');let sent=false;const oldFetch=global.fetch;
 global.fetch=async()=>{sent=true;throw Error('unexpected request');};
 try{await assert.rejects(api.createSession('project'),/安全随机数/);assert.equal(sent,false);}finally{global.fetch=oldFetch;}
}));
