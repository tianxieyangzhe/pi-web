require('./register.cjs');
const {test,before}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
let initializeSession,readTreeFile;
before(async()=>{
 const pi=await import('@earendil-works/pi-coding-agent'),Module=require('node:module'),old=Module._load;
 Module._load=function(spec,...args){return spec==='@earendil-works/pi-coding-agent'?pi:old.call(this,spec,...args);};
 try{({initializeSession}=require('../src/infrastructure/pi/initialize-session.server.ts'));({readTreeFile}=require('../src/infrastructure/pi/session-tree.server.ts'));}finally{Module._load=old;}
});
test('opening an empty coordinator persists a recoverable identity without prompt, tools or model',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coordinator-open-'));
 try{
  const first=initializeSession('bot:example',dir,dir),file=first.getSessionFile(),id=first.getSessionId();
  assert.ok(fs.statSync(file).size>0);assert.equal(readTreeFile(file,dir,id).entries.length,0);
  const raw=fs.readFileSync(file,'utf8'),reopened=initializeSession('bot:example',dir,dir);
  assert.equal(reopened.getSessionId(),id);assert.equal(fs.readFileSync(file,'utf8'),raw);
  assert.throws(()=>initializeSession('bot:example','/different-cwd',dir),e=>e.code==='NO_NATIVE_REF');assert.equal(fs.readFileSync(file,'utf8'),raw);
  fs.writeFileSync(file,'');assert.throws(()=>initializeSession('bot:example',dir,dir),e=>e.code==='NO_NATIVE_REF');assert.equal(fs.readFileSync(file,'utf8'),'');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
