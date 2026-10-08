require('./register.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createSessionExecutionService}=require('../src/application/session-execution-service.ts');

for(const mode of ['open','restore','reuse']){
 test(`display-only memory never enters main Pi input when sessions ${mode}`,async()=>{
  let value={id:`display-${mode}`,projectId:'p',sessionMemoryId:'m',state:'idle',agentId:null,agentSnapshot:null,mcpIds:[],nativeRef:mode==='open'?null:{kind:'pi'}};
  // Main execution may validate ownership, but must not read the memory's content.
  const memory={projectId:'p',get contextJson(){throw new Error('Display memory read by main request');}};
  let sent,operation;const inputs=[];const handle={};
  const runtime={
   getHandle(_,input){inputs.push(input);return mode==='reuse'?handle:undefined;},
   async open(input){operation='open';inputs.push(input);return {handle,nativeRef:{kind:'pi'}};},
   async restore(input){operation='restore';inputs.push(input);return handle;},
   async send(_,text){sent=text;},
  };
  const service=createSessionExecutionService({sessions:{get:()=>value,updateRuntime:(_,patch)=>{value={...value,...patch};return value;}},catalog:{},projects:{get:()=>({rootPath:'/tmp',status:'active'})},sessionMemories:{get:()=>memory},runtime});
  const events=[];for await(const event of service.send(value.id,'Follow up question'))events.push(event);
  assert.equal(operation,mode==='reuse'?undefined:mode);
  assert(inputs.length>0);for(const input of inputs)assert(!Object.hasOwn(input,'memoryContext'));
  assert.equal(sent,'Follow up question');assert(events.some(event=>event.type==='complete'));
 });
}

test('display memory can change during main reply without touching its Pi handle or input',async()=>{
 let value={id:'display-running',projectId:'p',sessionMemoryId:'m',state:'idle',agentId:null,agentSnapshot:null,mcpIds:[],nativeRef:{kind:'pi'}};
 const memory={projectId:'p',contextJson:{summary:'old'}};const handle={};let input;
 const service=createSessionExecutionService({sessions:{get:()=>value,updateRuntime:(_,patch)=>{value={...value,...patch};return value;}},catalog:{},projects:{get:()=>({rootPath:'/tmp',status:'active'})},sessionMemories:{get:()=>memory},runtime:{getHandle(_,next){input=next;return handle;},async send(current,text){memory.contextJson.summary='human correction';assert.equal(current,handle);assert.equal(text,'Continue');assert.equal(Object.hasOwn(input,'memoryContext'),false);}}});
 for await(const _ of service.send(value.id,'Continue')){}
 assert.equal(memory.contextJson.summary,'human correction');assert.deepEqual(handle,{});
});
