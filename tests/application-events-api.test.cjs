require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module'),path=require('node:path');
const {fixture}=require('./workspace-fixture.cjs');
const {createProjectRepository}=require('../src/infrastructure/database/project-repository.ts');
const {createSessionRepository}=require('../src/infrastructure/database/session-repository.ts');
const {createProjectSessionService}=require('../src/application/project-session-service.ts');
const {createCatalogService}=require('../src/application/catalog-service.ts');
const {SessionEvents}=require('../src/application/session-events.ts');
const {applicationChanges}=require('../src/application/application-changes.ts');
const {applicationEventResponse}=require('../src/shared/protocol/application-event-response.server.ts');
const {createProjectRulesStore}=require('../src/infrastructure/agents/project-rules-store.server.ts');
const {createProjectRuleGenerationsStore}=require('../src/infrastructure/agents/project-rule-generations.server.ts');
const {createProjectRulesService}=require('../src/application/project-rules-service.ts');
function setup(){
 const f=fixture(),projects=createProjectRepository(f.db),sessions=createSessionRepository(f.db),active=new Set(),workspaceActive=new Set();let previews=0,releaseGeneration;
 const presence={assertLease(){},renew(){},release(){}};
 const trees=new Map(),files=new Map();let messageReads=0,fileReads=0;
 const message=(id)=>{messageReads++;return trees.get(id)??{entries:[],activeLeafId:null};};
 const context=(id)=>{fileReads++;return files.get(id)??{files:[],writeETag:'initial'};};
 const events=new SessionEvents(presence,undefined,id=>({running:active.has(id)})),workspaceEvents=new SessionEvents(presence,undefined,id=>({running:workspaceActive.has(id)}));
 const projectSessions=createProjectSessionService({projects,sessions,operations:{list:()=>[]},preview:()=>{previews++;return {lastUserInput:null,lastActivityAt:null,previewUnavailable:false};}});
 const catalog=createCatalogService({projects,agents:{list:()=>[]},mcps:{list:()=>[]},normalizeProjectRoot:p=>p});
 const p=projects.create({name:'P',kind:'code',rootPath:f.a,description:null,status:'active'}),identity={scope:'project',projectId:p.id};
 const rulesStore=createProjectRulesStore(path.join(f.root,'rules'));
 const rules=createProjectRulesService({store:rulesStore,generations:createProjectRuleGenerationsStore(path.join(f.root,'tasks')),resolve:id=>{if(id.projectId!==p.id)throw new (require('../src/domain/errors.ts').DomainError)('NOT_FOUND','missing project',404,true);return {id:p.id,name:'P',rootPath:f.a};},prepare:{skill(){},async prepare(_body,_signal,progress){progress({phase:'reading',tool:'read'});await new Promise(resolve=>{releaseGeneration=resolve;});return {definition:{projects:[{id:p.id,rules:'# Generated rules'}]}};}}});
 const entry=require.resolve('../src/bootstrap/application-events.server.ts'),routeEntry=require.resolve('../src/app/api/events/route.ts'),original=Module._load;
 delete require.cache[entry];delete require.cache[routeEntry];
 Module._load=function(name,...args){
  if(name==='@/bootstrap/composition-root.server'||name==='./composition-root.server')return {services:{catalog,execution:{events,messages:message,contextFiles:context},projectSessions}};
  if(name==='@/bootstrap/workspace.server'||name==='./workspace.server')return {workspaceServices:{list:()=>f.repository.list(),get:id=>f.repository.get(id),sessions:id=>f.repository.sessions(id),messages:(_owner,id)=>message(id),contextFiles:(_owner,id)=>context(id),events:workspaceEvents}};
  if(name==='@/bootstrap/project-rules.server'||name==='./project-rules.server')return {projectRulesService:rules};
  if(name==='@/infrastructure/database/database.server')return {database:f.db};
  return original.call(this,name,...args);
 };
 let route;try{route=require(routeEntry);}finally{Module._load=original;delete require.cache[entry];delete require.cache[routeEntry];}
 return {...f,p,identity,rules,trees,files,get messageReads(){return messageReads;},get fileReads(){return fileReads;},projects,sessions,events,active,workspaceEvents,workspaceActive,get previews(){return previews;},finishGeneration:()=>releaseGeneration?.(),open(resources,signal){return route.GET(new Request('http://localhost/api/events?'+new URLSearchParams({resources:JSON.stringify(resources)}),{signal}));}};
}
function stream(response){
 assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);assert.equal(response.headers.get('cache-control'),'no-store, no-transform');
 const reader=response.body.getReader(),decoder=new TextDecoder(),queued=[];let buffer='';
 return {async next(resource,event='snapshot'){
  for(;;){const index=queued.findIndex(f=>f.event===event&&f.data.resource===resource);if(index>=0)return queued.splice(index,1)[0].data;
   const value=await reader.read();if(value.done)throw Error('stream closed');buffer+=decoder.decode(value.value,{stream:true});
   let split;while((split=buffer.indexOf('\n\n'))>=0){const text=buffer.slice(0,split);buffer=buffer.slice(split+2);if(text.startsWith(':'))continue;const lines=text.split('\n');queued.push({event:lines[0].slice(7),data:JSON.parse(lines[1].slice(6))});}
  }
 },close:()=>reader.cancel()};
}
test('GET events validates resource whitelist and isolates missing resources without blocking valid snapshots',async()=>{
 const f=setup();let s;try{
  for(const invalid of [[],['http://external.invalid'],['/api/projects/../files'],new Array(65).fill('navigation')])assert.equal(f.open(invalid).status,400);
  s=stream(f.open(['navigation','/api/projects/missing/sessions']));assert.deepEqual((await s.next('navigation')).data,{['project:'+f.p.id]:[]});
  assert.equal((await s.next('/api/projects/missing/sessions','resource_error')).error.code,'NOT_FOUND');
  assert.equal(f.previews,0);
 }finally{await s?.close();f.close();}
});
test('GET events pushes navigation activity and terminal updates across both scopes without reading transcript previews',async()=>{
 const f=setup();let s;try{
  const session=f.sessions.create({projectId:f.p.id,purpose:'',agentId:null,agentSnapshot:null,mcpIds:[],mcpSnapshots:[]});
  const w=f.repository.save(null,{name:'W',projects:[{rootPath:f.b}],defaultProjectIndex:0},'create-workspace'),ws=f.repository.createSession(w.id,undefined,'','create-session');
  s=stream(f.open(['navigation']));let data=(await s.next('navigation')).data;assert.deepEqual(data['project:'+f.p.id],[]);assert.deepEqual(data['workspace:'+w.id],[]);
  f.active.add(session.id);f.events.agent(session.id,{type:'session_state',state:'running'});
  f.workspaceActive.add(ws.id);f.workspaceEvents.agent(ws.id,{type:'session_state',state:'running'});
  data=(await s.next('navigation')).data;assert.deepEqual(data['project:'+f.p.id],[session.id]);assert.deepEqual(data['workspace:'+w.id],[ws.id]);
  f.active.clear();f.workspaceActive.clear();f.events.agent(session.id,{type:'complete'});f.workspaceEvents.agent(ws.id,{type:'complete'});
  data=(await s.next('navigation')).data;assert.deepEqual(data['project:'+f.p.id],[]);assert.deepEqual(data['workspace:'+w.id],[]);assert.equal(f.previews,0);
  await s.close();s=stream(f.open(['navigation']));assert.deepEqual((await s.next('navigation')).data,data);
 }finally{await s?.close();f.close();}
});
test('GET events sends catalog and subscribed session list updates only after successful repository mutations',async()=>{
 const f=setup();let s;try{
  const resource=`/api/projects/${f.p.id}/sessions`;
  s=stream(f.open(['catalog',resource]));assert.equal((await s.next('catalog')).data.projects[0].name,'P');assert.deepEqual((await s.next(resource)).data,[]);
  f.projects.update(f.p.id,{name:'Renamed'});assert.equal((await s.next('catalog')).data.projects[0].name,'Renamed');
  const created=f.sessions.create({projectId:f.p.id,purpose:'New session',agentId:null,agentSnapshot:null,mcpIds:[],mcpSnapshots:[]});
  assert.equal((await s.next(resource)).data[0].id,created.id);
  f.sessions.delete(f.p.id,created.id);assert.deepEqual((await s.next(resource)).data,[]);
 }finally{await s?.close();f.close();}
});
test('GET events keeps workspace lists scoped and reports removal without disrupting navigation',async()=>{
 const f=setup();let s;try{
  const w=f.repository.save(null,{name:'W',projects:[{rootPath:f.b}],defaultProjectIndex:0},'workspace-one');
  const other=f.repository.save(null,{name:'Other',projects:[{rootPath:f.a}],defaultProjectIndex:0},'workspace-two');
  const unrelated=f.repository.createSession(other.id,undefined,'Other session','other-session');
  const resource=`/api/workspaces/${w.id}/sessions`;s=stream(f.open([resource,'navigation']));assert.deepEqual((await s.next(resource)).data,[]);await s.next('navigation');
  const own=f.repository.createSession(w.id,undefined,'Own session','own-session');const values=(await s.next(resource)).data;assert.deepEqual(values.map(v=>v.id),[own.id]);assert(!values.some(v=>v.id===unrelated.id));
  f.repository.deleteSession(w.id,own.id);assert.deepEqual((await s.next(resource)).data,[]);
 }finally{await s?.close();f.close();}
});
test('GET events pushes rule generation progress and final version without a status polling loop',async()=>{
 const f=setup();let s;try{
  const resource=`/api/projects/${f.p.id}/agent-rules`;s=stream(f.open([resource]));const initial=(await s.next(resource)).data;
  f.rules.start(f.identity,{skillId:null},initial.writeETag,'generate-once');
  let value=(await s.next(resource)).data;assert.equal(value.generation.status,'queued');
  value=(await s.next(resource)).data;assert.equal(value.generation.status,'running');assert.equal(value.generation.progress.tool,'read');
  f.finishGeneration();value=(await s.next(resource)).data;assert.equal(value.generation.status,'succeeded');assert.equal(value.markdown,'# Generated rules');
 }finally{f.finishGeneration();await s?.close();f.close();}
});
for(const scope of ['project','workspace'])test(`GET events pushes ${scope} full trees separately from context files and rejects foreign ownership`,async()=>{
 const f=setup();let s;try{
  let owner=f.p.id,session;
  if(scope==='project')session=f.sessions.create({projectId:owner,purpose:'',agentId:null,agentSnapshot:null,mcpIds:[],mcpSnapshots:[]});
  else{const w=f.repository.save(null,{name:'W',projects:[{rootPath:f.b}],defaultProjectIndex:0},'workspace-tree');owner=w.id;session=f.repository.createSession(owner,undefined,'','session-tree');}
  const base=`/api/${scope==='project'?'projects':'workspaces'}/${owner}/sessions/${session.id}`,messages=base+'/messages',context=base+'/context-files';
  const foreign=base.replace(owner,'missing-owner')+'/messages';
  s=stream(f.open([messages,context,foreign]));assert.deepEqual((await s.next(messages)).data,{entries:[],activeLeafId:null});assert.equal((await s.next(context)).data.writeETag,'initial');assert.equal((await s.next(foreign,'resource_error')).error.code,'NOT_FOUND');
  const initialFileReads=f.fileReads;
  const snapshot={entries:[{entry:{id:'internal',type:'custom',data:{thinking:'full original',tool:{password:'raw'}}}},{entry:{id:'branch',parentId:null,type:'custom',data:{text:'other branch'}}}],activeLeafId:'internal',tokenUsage:{totalTokens:5,complete:true}};
  f.trees.set(session.id,snapshot);
  const events=scope==='project'?f.events:f.workspaceEvents;
  events.agent(session.id,{type:'pi_event',piType:'entry_appended',temporaryId:null,payload:{entry:{id:'internal'}}});
  assert.deepEqual((await s.next(messages)).data,snapshot);assert.equal(f.fileReads,initialFileReads,'native entries must not reread reference files');
  const nextFiles={files:[{id:'ref',name:'Rules.md',path:'Rules.md'}],writeETag:'new'};f.files.set(session.id,nextFiles);
  applicationChanges.publish({topic:'context-files',key:session.id});assert.deepEqual((await s.next(context)).data,nextFiles);
  const final={...snapshot,latestRunUsage:{totalTokens:5,complete:true}};f.trees.set(session.id,final);events.agent(session.id,{type:'complete'});
  assert.deepEqual((await s.next(messages)).data,final);assert.equal(f.fileReads,initialFileReads+1);
 }finally{await s?.close();f.close();}
});
test('GET events serializes slow snapshot reads, merges concurrent changes, and releases listeners on abort',async()=>{
 let value=0,reads=0,release;const abort=new AbortController();
 const response=applicationEventResponse(new Request('http://localhost/api/events?resources=%5B%22navigation%22%5D',{signal:abort.signal}),()=>({matches:()=>true,read:async()=>{reads++;const snapshot=value;if(reads===1)await new Promise(resolve=>{release=resolve;});return snapshot;}}));
 const s=stream(response);value=2;applicationChanges.publish({topic:'sessions'});applicationChanges.publish({topic:'sessions'});release();
 assert.equal((await s.next('navigation')).data,0);assert.equal((await s.next('navigation')).data,2);assert.equal(reads,2);
 abort.abort();applicationChanges.publish({topic:'sessions'});await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,2);await s.close();
});
