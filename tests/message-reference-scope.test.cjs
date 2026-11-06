require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createMessageReferenceScope}=require('../src/infrastructure/pi/message-reference-scope.server.ts');
const {appendMessageReferences}=require('../src/infrastructure/pi/message-references.server.ts');

test('reference scope identifies sends without filtering native context or compaction',async()=>{
 const scope=createMessageReferenceScope(),hooks={};scope.extension({on:(event,fn)=>hooks[event]=fn});
 let written;const session={model:{input:['text','image']},sendCustomMessage:async message=>written=message};
 const old={role:'custom',customType:'user_reference_files',details:{names:['old.txt']},content:'old secret'},user={role:'user',content:'question'},unrelated={role:'custom',customType:'other',content:'keep'};
 const id=scope.begin();await appendMessageReferences(session,[{type:'text',text:'current secret',referenceName:'now.txt'},{type:'image',mimeType:'image/png',data:'YWJj'}],id);
 const current={role:'custom',...written},messages=[old,unrelated,current,user];
 assert.equal(hooks.context,undefined);assert.equal(hooks.session_before_compact,undefined);
 assert.deepEqual(messages,[old,unrelated,current,user]);
 scope.end();const next=scope.begin();assert.notEqual(next,id);scope.end();
 await assert.rejects(()=>appendMessageReferences(session,[{type:'text',text:'x'}]));
});

test('text-only or unavailable models reject images before writing reference nodes while text remains usable',async()=>{
 const image={type:'image',mimeType:'image/png',data:'YWJj'};
 for(const model of [undefined,{input:['text']}]){
  let writes=0;const session={model,sendCustomMessage:async()=>{writes++;}};
  await assert.rejects(()=>appendMessageReferences(session,[{type:'text',text:'参考图片 screenshot.png'},image],'turn'),error=>error.code==='MODEL_IMAGE_UNSUPPORTED'&&error.status===422&&error.recoverable===true);
  assert.equal(writes,0);
  await appendMessageReferences(session,[{type:'text',text:'文件正文'}],'turn');assert.equal(writes,1);
 }
});

test('Pi loader includes the inline scope extension even when external extensions are disabled',async()=>{
 const {DefaultResourceLoader}=await import('@earendil-works/pi-coding-agent');const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'pi-ref-scope-'));
 try{const scope=createMessageReferenceScope();const loader=new DefaultResourceLoader({cwd,agentDir:cwd,noExtensions:true,noSkills:true,noContextFiles:true,noPromptTemplates:true,noThemes:true,extensionFactories:[scope.extension]});await loader.reload();const result=loader.getExtensions();assert.equal(result.errors.length,0);assert.equal(result.extensions.length,1);assert.equal(result.extensions[0].handlers.get('context'),undefined);assert.equal(result.extensions[0].handlers.get('session_before_compact'),undefined);}finally{fs.rmSync(cwd,{recursive:true,force:true});}
});
