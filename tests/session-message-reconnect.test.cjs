require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),React=require('react'),{JSDOM}=require('jsdom');
const {useSessionTree}=require('../web/workspace/conversation/use-session-tree.ts');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('rejected file submission reconnects on lease errors without replay and uses fresh lease for manual retry',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),keys=['window','document','navigator','HTMLElement','IS_REACT_ACT_ENVIRONMENT','fetch','EventSource'],old=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(global,k)]));
 for(const k of keys.slice(0,5))Object.defineProperty(global,k,{configurable:true,writable:true,value:k==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[k]});
 let state,opens=0,code='INVALID_INPUT',pending;const sources=[],messages=[];
 class Source{listeners={};constructor(){sources.push(this);}addEventListener(type,fn){this.listeners[type]=fn;}close(){this.closed=true;}}
 global.EventSource=Source;global.fetch=async(url,init)=>{
  if(url.endsWith('/open'))return Response.json({data:{leaseId:'lease-'+(++opens),status:'ready',outcome:null}});
  if(url.endsWith('/messages')){messages.push(init);if(code==='deferred')return new Promise(resolve=>{pending=resolve;});if(code)return Response.json({error:{code,message:'controlled rejection'}},{status:409});return Response.json({data:{accepted:true}});}
  return new Response(null,{status:204});
 };
 const {createRoot}=require('react-dom/client'),root=createRoot(document.getElementById('root')),read=async()=>({entries:[],activeLeafId:null});
 function Harness(){state=useSessionTree('/sessions/a',read);return null;}
 const ready=()=>React.act(async()=>{sources.at(-1).listeners.ready({data:'{}'});await tick();});
 const refs=[{name:'notes.txt',data:Buffer.from('body').toString('base64')}];
 const reject=async()=>React.act(async()=>{await assert.rejects(()=>state.send('read',refs),e=>e.code===code&&e.status===409);await tick();});
 try{
  await React.act(async()=>{root.render(React.createElement(Harness));await tick();});await ready();
  await reject();assert.equal(opens,1,'ordinary validation errors must not reopen');assert.equal(state.ready,true);
  for(const leaseCode of ['RUNTIME_NOT_OPEN','RUNTIME_LEASE_EXPIRED']){
   code=leaseCode;const before=messages.length;await reject();assert.equal(state.ready,false);assert.equal(messages.length,before+1,'no automatic message replay');assert.equal(opens,leaseCode==='RUNTIME_NOT_OPEN'?2:3);assert.equal(sources.at(-2).closed,true);assert.equal(state.pendingText,'');await ready();assert.equal(state.ready,true);
  }
  code=null;await React.act(async()=>{await state.send('read',refs);await tick();});assert.equal(messages.at(-1).headers['x-session-lease-id'],'lease-3');assert.deepEqual(JSON.parse(messages.at(-1).body).references,refs);
  code='deferred';let request;await React.act(async()=>{request=state.send('late',refs).catch(e=>e);await tick();});await React.act(async()=>{state.retryOpen();await tick();});await ready();assert.equal(opens,4);
  await React.act(async()=>{pending(Response.json({error:{code:'RUNTIME_NOT_OPEN',message:'late'}},{status:409}));await request;await tick();});assert.equal(opens,4,'late lease rejection must preserve newer connection');assert.equal(state.ready,true);
 }finally{await React.act(async()=>root.unmount());dom.window.close();for(const k of keys){const value=old.get(k);if(value)Object.defineProperty(global,k,value);else delete global[k];}}
});
