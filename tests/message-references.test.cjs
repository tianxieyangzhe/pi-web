require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseMessageReferences}=require('../src/domain/message-references.ts');
const {createSessionExecutionService}=require('../src/application/session-execution-service.ts');
const {createBotService}=require('../src/application/bot-service.ts');
const {appendMessageReferences}=require('../src/infrastructure/pi/message-references.server.ts');
const upload=(name,bytes)=>({name,data:Buffer.from(bytes).toString('base64')});

test('uploaded UTF-8 text and native images are validated and projected',()=>{
 const refs=[upload('note.txt','你好'),upload('image.png',[137,80,78,71,13,10,26,10,0])];
 const result=parseMessageReferences(refs);assert.match(result[0].text,/你好/);assert.equal(result[2].mimeType,'image/png');assert.equal(result[2].data,refs[1].data);
 for(const bad of [[{projectId:'p',path:'a'}],[{name:'../secret',data:'YQ=='}],[{name:'x',data:'bad'}],[upload('x',[0,1])],[upload('x',[255,255])],Array(11).fill(upload('a','a'))]) assert.throws(()=>parseMessageReferences(bad));
 assert.throws(()=>parseMessageReferences([upload('huge',Buffer.alloc(2*1024*1024+1))]),e=>e.code==='FILE_TOO_LARGE');
 assert.throws(()=>parseMessageReferences(Array(5).fill(upload('large',Buffer.alloc(2*1024*1024,65)))),e=>e.code==='FILE_TOO_LARGE');
});
test('project send rejects invalid uploads before runtime and passes content',async()=>{
 let session={id:'references-session',projectId:'p',sessionMemoryId:'m',state:'idle',agentId:null,agentSnapshot:null,mcpIds:[],nativeRef:null};const calls=[];
 const service=createSessionExecutionService({sessions:{get:()=>session,updateRuntime:(_,patch)=>session={...session,...patch}},catalog:{},projects:{get:()=>({status:'active',rootPath:'/tmp'})},sessionMemories:{get:()=>({projectId:'p'})},runtime:{getHandle:()=>({}),send:async(_h,text,_emit,_timing,refs)=>calls.push({text,refs})}});
 assert.throws(()=>service.send(session.id,'hello',undefined,[{path:'x',projectId:'p'}]));assert.equal(calls.length,0);
 for await(const _ of service.send(session.id,'hello',undefined,[upload('a.txt','contents')])){};
 assert.equal(calls[0].text,'hello');assert.match(calls[0].refs[0].text,/contents/);
});
test('project send accepts only its own project files',async()=>{
 let session={id:'project-reference-session',projectId:'p',sessionMemoryId:'m',state:'idle',agentId:null,agentSnapshot:null,mcpIds:[],nativeRef:null};let sent;
 const service=createSessionExecutionService({sessions:{get:()=>session,updateRuntime:(_,patch)=>session={...session,...patch}},catalog:{},projects:{get:()=>({status:'active',rootPath:'/tmp'})},sessionMemories:{get:()=>({projectId:'p'})},readProjectReference:ref=>upload(ref.path,'owned'),runtime:{getHandle:()=>({}),send:async(_handle,_text,_emit,_timing,refs)=>{sent=refs;}}});
 assert.throws(()=>service.send(session.id,'hello',undefined,[{projectId:'other',path:'x'}]),e=>e.code==='REFERENCE_OUTSIDE_SCOPE');
 for await(const _ of service.send(session.id,'hello',undefined,[{projectId:'p',path:'x'}])){}assert.match(sent[0].text,/owned/);
});
test('Bot coordinator accepts uploads independently of project bindings',async()=>{
 const caps={readFiles:false,writeFiles:false,readProjects:false,dispatchTasks:false,dispatchProjectWrites:false,exchangeMessages:false};
 const agent={id:'a',kind:'coordinator',status:'active',revision:1,contentSha256:'a'.repeat(64),name:'Coordinator',description:null,definition:{instructions:'coordinate',capabilities:caps}};
 const snapshot={agentId:'a',kind:'coordinator',revision:1,contentSha256:agent.contentSha256,name:agent.name,description:null,botId:null,projectId:null,definition:agent.definition};
 const c={id:'c',botId:'b',coordinatorAgentId:'a',coordinatorAgentSnapshot:snapshot,nativeRef:null};
 const repository={get:table=>table==='bots'?{id:'b',status:'active',workingDirectory:'/tmp',maxParallelExecutions:1}:c,conversationConfiguration:()=>[],projectCalls:()=>[]};
 let sent;const service=createBotService({repository,workspace:{sessionDirectory:()=>'/tmp'},runtime:{run:async(input,text)=>{sent={input,text};}},runtimeInstanceId:'test',sessions:{},projects:{},memories:{},catalog:{getAgent:()=>agent}});
 assert.throws(()=>service.send('b','c','hello','key',undefined,[{source:'bot',path:'x'}]));assert.equal(sent,undefined);
 assert.equal(service.send('b','c','hello','key',undefined,[upload('note.txt','data')]).accepted,true);assert.match(sent.input.referenceContent[0].text,/data/);assert.equal(sent.input.allowRead,false);await new Promise(resolve=>setImmediate(resolve));
});
test('Bot coordinator sends workspace and project snapshots without granting file tools',async()=>{
 const caps={readFiles:false,writeFiles:false,readProjects:false,dispatchTasks:false,dispatchProjectWrites:false,exchangeMessages:false};const agent={id:'a',kind:'coordinator',status:'active',revision:1,contentSha256:'a'.repeat(64),name:'Coordinator',description:null,definition:{instructions:'coordinate',capabilities:caps}};const snapshot={agentId:'a',kind:'coordinator',revision:1,contentSha256:agent.contentSha256,name:agent.name,description:null,botId:null,projectId:null,definition:agent.definition};const c={id:'mixed-c',botId:'b',coordinatorAgentId:'a',coordinatorAgentSnapshot:snapshot,nativeRef:null};const repository={get:table=>table==='bots'?{id:'b',status:'active',workingDirectory:'/trusted',maxParallelExecutions:1}:c,conversationConfiguration:()=>[{projectId:'p',agents:[]}],projectCalls:()=>[]};let sent,root;
 const service=createBotService({repository,workspace:{sessionDirectory:()=>'/tmp'},runtime:{run:async input=>{sent=input;}},runtimeInstanceId:'test',sessions:{},projects:{get:()=>({id:'p',status:'active',rootPath:'/trusted'})},memories:{},catalog:{getAgent:()=>agent},readBotReference:(r,p)=>{root=r;return upload(p,'workspace');},readProjectReference:ref=>upload(ref.path,'project')});
 service.send('b','mixed-c','hello','k',undefined,[{source:'bot',path:'x'},{projectId:'p',path:'y'}]);assert.equal(root,'/trusted');assert.match(sent.referenceContent[0].text,/workspace/);assert.match(sent.referenceContent[1].text,/project/);assert.equal(sent.allowRead,false);await new Promise(resolve=>setImmediate(resolve));
});
test('Bot coordinator restricts project references to active conversation bindings',async()=>{
 const caps={readFiles:false,writeFiles:false,readProjects:false,dispatchTasks:false,dispatchProjectWrites:false,exchangeMessages:false};const agent={id:'a',kind:'coordinator',status:'active',revision:1,contentSha256:'a'.repeat(64),name:'Coordinator',description:null,definition:{instructions:'coordinate',capabilities:caps}};const snapshot={agentId:'a',kind:'coordinator',revision:1,contentSha256:agent.contentSha256,name:agent.name,description:null,botId:null,projectId:null,definition:agent.definition};
 const c={id:'c2',botId:'b',coordinatorAgentId:'a',coordinatorAgentSnapshot:snapshot,nativeRef:null};const repository={get:table=>table==='bots'?{id:'b',status:'active',workingDirectory:'/tmp',maxParallelExecutions:1}:c,conversationConfiguration:()=>[{projectId:'p',agents:[]},{projectId:'archived',agents:[]}],projectCalls:()=>[]};let sent;
 const service=createBotService({repository,workspace:{sessionDirectory:()=>'/tmp'},runtime:{run:async input=>{sent=input;}},runtimeInstanceId:'test',sessions:{},projects:{get:id=>({id,status:id==='archived'?'archived':'active',rootPath:'/tmp'})},memories:{},catalog:{getAgent:()=>agent},readProjectReference:ref=>upload(ref.path,'project')});
 assert.throws(()=>service.send('b','c2','hi','k',undefined,[{projectId:'outside',path:'x'}]),e=>e.code==='REFERENCE_OUTSIDE_SCOPE');assert.throws(()=>service.send('b','c2','hi','k',undefined,[{projectId:'archived',path:'x'}]),e=>e.code==='REFERENCE_OUTSIDE_SCOPE');
 // The runtime input also requires all bound projects active; exercise project membership with an active-only snapshot.
 repository.conversationConfiguration=()=>[{projectId:'p',agents:[]}];service.send('b','c2','hi','k',undefined,[{projectId:'p',path:'x'}]);assert.match(sent.referenceContent[0].text,/project/);await new Promise(resolve=>setImmediate(resolve));
});
test('mixed uploads and project files enforce shared limits and project membership',()=>{
 const read=ref=>upload(ref.path,'project data');
 const result=parseMessageReferences([upload('local.txt','local'),{projectId:'p',path:'project.txt'}],new Set(['p']),read);
 assert.match(result[0].text,/local/);assert.match(result[1].text,/project data/);
 assert.throws(()=>parseMessageReferences([{projectId:'other',path:'x'}],new Set(['p']),read),e=>e.code==='REFERENCE_OUTSIDE_SCOPE');
 assert.throws(()=>parseMessageReferences([{projectId:'p',path:'x'},{projectId:'p',path:'x'}],new Set(['p']),read),e=>e.code==='INVALID_REFERENCES');
 assert.throws(()=>parseMessageReferences([upload('a',Buffer.alloc(2*1024*1024,65)),{projectId:'p',path:'x'}, {projectId:'p',path:'y'}, {projectId:'p',path:'z'}, {projectId:'p',path:'w'}],new Set(['p']),ref=>upload(ref.path,Buffer.alloc(2*1024*1024,65))),e=>e.code==='FILE_TOO_LARGE');
});
test('project file references enforce real paths, ignored directories and limits',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const root=fs.mkdtempSync(path.join(os.tmpdir(),'project-ref-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'project-ref-out-'));
 const repo=require.resolve('../src/infrastructure/database/project-repository.server.ts');require.cache[repo]={id:repo,filename:repo,loaded:true,exports:{projectRepository:{get:id=>id==='p'?{rootPath:root,status:'active'}:null}}};
 const {readProjectReference}=require('../src/infrastructure/projects/project-files.server.ts');
 try {fs.writeFileSync(path.join(root,'note.txt'),'data');fs.writeFileSync(path.join(root,'.env'),'secret');fs.mkdirSync(path.join(root,'node_modules'));fs.writeFileSync(path.join(root,'node_modules','x'),'hidden');fs.writeFileSync(path.join(outside,'outside'),'secret');fs.symlinkSync(path.join(outside,'outside'),path.join(root,'escape'));fs.writeFileSync(path.join(root,'large'),Buffer.alloc(2*1024*1024+1));
 assert.equal(Buffer.from(readProjectReference({projectId:'p',path:'note.txt'}).data,'base64').toString(),'data');
 for(const bad of ['../outside','.env','node_modules/x','escape','large']) assert.throws(()=>readProjectReference({projectId:'p',path:bad}));
 }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});delete require.cache[repo];delete require.cache[require.resolve('../src/infrastructure/projects/project-files.server.ts')];}
});
test('Bot workspace directory and reference enforce ownership and safe paths',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const root=fs.mkdtempSync(path.join(os.tmpdir(),'bot-ref-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'bot-ref-out-'));const {botFiles,readBotReference}=require('../src/infrastructure/bots/bot-files.server.ts');const {listBotReferenceFiles}=require('../src/application/bot-reference-files.ts');const repo={get:table=>table==='bots'?{id:'b',status:'active',workingDirectory:root}:{id:'c',botId:'b'}};
 try{fs.writeFileSync(path.join(root,'note'),'contents');fs.writeFileSync(path.join(root,'.env'),'secret');fs.mkdirSync(path.join(root,'dist'));fs.writeFileSync(path.join(root,'dist','x'),'hidden');fs.writeFileSync(path.join(outside,'escape'),'secret');fs.symlinkSync(path.join(outside,'escape'),path.join(root,'escape'));assert.equal(listBotReferenceFiles(repo,botFiles.list,'b','c','').entries.some(e=>e.name==='note'),true);assert.throws(()=>listBotReferenceFiles(repo,botFiles.list,'other','c',''),e=>e.code==='NOT_FOUND');assert.throws(()=>botFiles.list(root,'',[root]),e=>e.code==='BOT_WORKSPACE_PROJECT_OVERLAP');assert.equal(Buffer.from(readBotReference(root,'note').data,'base64').toString(),'contents');for(const bad of ['../escape','.env','dist/x','escape'])assert.throws(()=>readBotReference(root,bad));const refs=parseMessageReferences([{source:'bot',path:'note'}],new Set(),undefined,ref=>readBotReference(root,ref.path));assert.match(refs[0].text,/contents/);assert.throws(()=>parseMessageReferences([{source:'bot',path:'note'}]),e=>e.code==='REFERENCE_OUTSIDE_SCOPE');}finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});}
});
test('Pi reference material is invisible and includes native images',async()=>{let value;await appendMessageReferences({sendCustomMessage:async message=>{value=message;}},[{type:'image',mimeType:'image/png',data:'abc'}],'turn');assert.equal(value.display,false);assert.equal(value.content[1].type,'image');});
