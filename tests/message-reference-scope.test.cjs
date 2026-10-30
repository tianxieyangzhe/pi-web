require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createMessageReferenceScope}=require('../src/infrastructure/pi/message-reference-scope.server.ts');
const {appendMessageReferences}=require('../src/infrastructure/pi/message-references.server.ts');

test('scope keeps only current references for every model call and removes all from compaction',async()=>{
 const scope=createMessageReferenceScope(),hooks={};scope.extension({on:(event,fn)=>hooks[event]=fn});
 let written;const session={sendCustomMessage:async message=>written=message};
 const old={role:'custom',customType:'user_reference_files',details:{names:['old.txt']},content:'old secret'},user={role:'user',content:'question'},unrelated={role:'custom',customType:'other',content:'keep'};
 const id=scope.begin();await appendMessageReferences(session,[{type:'text',text:'current secret',referenceName:'now.txt'},{type:'image',mimeType:'image/png',data:'YWJj'}],id);
 const current={role:'custom',...written},messages=[old,unrelated,current,user];
 assert.deepEqual((await hooks.context({messages})).messages,[unrelated,current,user]);
 assert.deepEqual((await hooks.context({messages})).messages,[unrelated,current,user]); // tool loop
 const preparation={messagesToSummarize:messages,turnPrefixMessages:messages};await hooks.session_before_compact({preparation});assert.deepEqual(preparation.messagesToSummarize,[unrelated,user]);assert.deepEqual(preparation.turnPrefixMessages,[unrelated,user]);
 scope.end();assert.deepEqual((await hooks.context({messages})).messages,[unrelated,user]);
 const next=scope.begin();assert.notEqual(next,id);assert.deepEqual((await hooks.context({messages})).messages,[unrelated,user]);scope.end();
 await assert.rejects(()=>appendMessageReferences(session,[{type:'text',text:'x'}]));
});

test('Pi loader includes the inline scope extension even when external extensions are disabled',async()=>{
 const {DefaultResourceLoader}=await import('@earendil-works/pi-coding-agent');const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'pi-ref-scope-'));
 try{const scope=createMessageReferenceScope();const loader=new DefaultResourceLoader({cwd,agentDir:cwd,noExtensions:true,noSkills:true,noContextFiles:true,noPromptTemplates:true,noThemes:true,extensionFactories:[scope.extension]});await loader.reload();const result=loader.getExtensions();assert.equal(result.errors.length,0);assert.equal(result.extensions.length,1);assert.ok(result.extensions[0].handlers.get('context'));assert.ok(result.extensions[0].handlers.get('session_before_compact'));}finally{fs.rmSync(cwd,{recursive:true,force:true});}
});
