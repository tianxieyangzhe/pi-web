require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseMessageReferences}=require('../src/domain/message-references.ts');
const {createSessionExecutionService}=require('../src/application/session-execution-service.ts');
const {appendMessageReferences}=require('../src/infrastructure/pi/message-references.server.ts');
const upload=(name,bytes)=>({name,data:Buffer.from(bytes).toString('base64')});

test('uploaded UTF-8 text and native images are validated and projected',()=>{
 const refs=[upload('note.txt','你好'),upload('image.png',[137,80,78,71,13,10,26,10,0])];
 const result=parseMessageReferences(refs);assert.match(Buffer.from(result[0].data,'base64').toString(),/你好/);assert.equal(result[2].mimeType,'image/png');assert.equal(result[2].data,refs[1].data);
 for(const bad of [[{projectId:'p',path:'a'}],[{name:'../secret',data:'YQ=='}],[{name:'x',data:'bad'}],[upload('x',[0,1])],[upload('x',[255,255])],Array(11).fill(upload('a','a'))]) assert.throws(()=>parseMessageReferences(bad));
 const formerlyTooLarge=upload('large',Buffer.alloc(3*1024*1024,65));assert.equal(parseMessageReferences(Array(3).fill(formerlyTooLarge)).length,3);
 assert.throws(()=>parseMessageReferences([{name:'huge',data:'A'.repeat(Math.ceil(50_000_000/3)*4+4)}]),e=>e.code==='FILE_TOO_LARGE'&&e.status===413);
 assert.throws(()=>parseMessageReferences([{name:'exactly-50MB',data:'A'.repeat(Math.ceil(50_000_000/3)*4-1)+'='}]),e=>e.code==='FILE_TOO_LARGE'&&e.status===413);
});
test('project send rejects invalid uploads before runtime and passes content',async()=>{
 let session={id:'references-session',projectId:'p',sessionMemoryId:'m',state:'idle',agentId:null,agentSnapshot:null,mcpIds:[],nativeRef:null};const calls=[];
 const service=createSessionExecutionService({sessions:{get:()=>session,updateRuntime:(_,patch)=>session={...session,...patch}},catalog:{},projects:{get:()=>({status:'active',rootPath:'/tmp'})},sessionMemories:{get:()=>({projectId:'p'})},runtime:{getHandle:()=>({}),close:async()=>{},send:async(_h,text,_emit,_timing,refs)=>calls.push({text,refs})}});
 assert.throws(()=>service.send(session.id,'hello',undefined,[{path:'x',projectId:'p'}]));assert.equal(calls.length,0);
 for await(const _ of service.send(session.id,'hello',undefined,[upload('a.txt','contents')])){};
 assert.equal(calls[0].text,'hello');assert.match(Buffer.from(calls[0].refs[0].data,'base64').toString(),/contents/);
});
test('project send accepts only its own project files',async()=>{
 let session={id:'project-reference-session',projectId:'p',sessionMemoryId:'m',state:'idle',agentId:null,agentSnapshot:null,mcpIds:[],nativeRef:null};let sent;
 const service=createSessionExecutionService({sessions:{get:()=>session,updateRuntime:(_,patch)=>session={...session,...patch}},catalog:{},projects:{get:()=>({status:'active',rootPath:'/tmp'})},sessionMemories:{get:()=>({projectId:'p'})},resolveProjectReference:ref=>({name:ref.path,absolutePath:'/tmp/owned'}),runtime:{getHandle:()=>({}),close:async()=>{},send:async(_handle,_text,_emit,_timing,refs)=>{sent=refs;}}});
 assert.throws(()=>service.send(session.id,'hello',undefined,[{projectId:'other',path:'x'}]),e=>e.code==='REFERENCE_OUTSIDE_SCOPE');
 for await(const _ of service.send(session.id,'hello',undefined,[{projectId:'p',path:'x'}])){}assert.match(sent[0].text,/owned/);
});
test('mixed uploads and project files enforce shared limits and project membership',()=>{
 const read=ref=>({name:ref.path,absolutePath:'/trusted/project.txt'});
 const result=parseMessageReferences([upload('local.txt','local'),{projectId:'p',path:'project.txt'}],new Set(['p']),read);
 assert.match(Buffer.from(result[0].data,'base64').toString(),/local/);assert.match(result[1].text,/absolutePath/);assert.match(result[1].text,/未读取文件内容/);
 assert.throws(()=>parseMessageReferences([{projectId:'other',path:'x'}],new Set(['p']),read),e=>e.code==='REFERENCE_OUTSIDE_SCOPE');
 assert.throws(()=>parseMessageReferences([{projectId:'p',path:'x'},{projectId:'p',path:'x'}],new Set(['p']),read),e=>e.code==='INVALID_REFERENCES');
 assert.throws(()=>parseMessageReferences([{projectId:'p',path:'x',absolutePath:'/client/chosen'}],new Set(['p']),read),e=>e.code==='INVALID_REFERENCES');
 assert.throws(()=>parseMessageReferences(Array(11).fill({projectId:'p',path:'x'}),new Set(['p']),read),e=>e.code==='INVALID_REFERENCES');
 const large=upload('large',Buffer.alloc(12_500_000,65));
 assert.equal(parseMessageReferences(Array(4).fill(large)).length,4,'exactly 50 MB combined is accepted');
 assert.equal(parseMessageReferences([large,large,large,large,{projectId:'p',path:'x'}],new Set(['p']),read).length,5,'project location does not consume snapshot bytes');
 assert.throws(()=>parseMessageReferences([large,large,large,large,upload('extra','x')]),e=>e.code==='FILE_TOO_LARGE'&&e.status===413);
});
test('project file references validate real paths without reading bytes or applying snapshot size limits',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const root=fs.mkdtempSync(path.join(os.tmpdir(),'project-ref-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'project-ref-out-'));
 const repo=require.resolve('../src/infrastructure/database/project-repository.server.ts');require.cache[repo]={id:repo,filename:repo,loaded:true,exports:{projectRepository:{get:id=>id==='p'?{rootPath:root,status:'active'}:null}}};
 const {resolveProjectReference}=require('../src/infrastructure/projects/project-files.server.ts');
 try {fs.writeFileSync(path.join(root,'note.txt'),'data');fs.writeFileSync(path.join(root,'.env'),'secret');fs.mkdirSync(path.join(root,'node_modules'));fs.writeFileSync(path.join(root,'node_modules','x'),'hidden');fs.writeFileSync(path.join(outside,'outside'),'secret');fs.symlinkSync(path.join(outside,'outside'),path.join(root,'escape'));const fd=fs.openSync(path.join(root,'large'),'w');fs.ftruncateSync(fd,50_000_000);fs.closeSync(fd);
 fs.writeFileSync(path.join(root,'bigger-than-old-limit'),Buffer.alloc(3*1024*1024,65));
 const originalRead=fs.readSync;fs.readSync=()=>{throw Error('Reference resolution must not read content');};
 try{
  for(const name of ['note.txt','bigger-than-old-limit','large'])assert.deepEqual(resolveProjectReference({projectId:'p',path:name}),{name,absolutePath:fs.realpathSync(path.join(root,name))});
 }finally{fs.readSync=originalRead;}
 for(const bad of ['../outside','.env','node_modules/x','escape','node_modules','missing']) assert.throws(()=>resolveProjectReference({projectId:'p',path:bad}));
 }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});delete require.cache[repo];delete require.cache[require.resolve('../src/infrastructure/projects/project-files.server.ts')];}
});

test('Pi reference material is invisible and includes native images',async()=>{let value;await appendMessageReferences({model:{input:['text','image']},sendCustomMessage:async message=>{value=message;}},[{type:'image',mimeType:'image/png',data:'abc'}],'turn');assert.equal(value.display,false);assert.equal(value.content[1].type,'image');});
