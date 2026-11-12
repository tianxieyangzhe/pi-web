require('./register.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
async function modules(){
  const pi=await import('@earendil-works/pi-coding-agent'),ai=await import('@earendil-works/pi-ai'),original=Module._load;
  Module._load=function(spec,...args){if(spec==='@earendil-works/pi-coding-agent')return pi;if(spec==='@earendil-works/pi-ai')return ai;return original.call(this,spec,...args);};
  try{return {pi,...require('../src/infrastructure/pi/model-config.server.ts'),...require('../src/infrastructure/pi/pi-session-runtime.server.ts'),...require('../src/infrastructure/pi/session-artifacts.server.ts')};}finally{Module._load=original;}
}
for(const scope of ['project','workspace'])test(`${scope} open aligns cold and live sessions with default, preserves history and reports unavailable defaults`,async()=>{
  const m=await modules(),{fixture}=require('./workspace-fixture.cjs'),f=fixture();
  f.a=fs.realpathSync(f.a);
  const configRoot=fs.mkdtempSync(path.join(os.tmpdir(),'open-default-api-'));
  const model=id=>({id,name:id,reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:64000,maxTokens:1234});
  fs.writeFileSync(path.join(configRoot,'models.json'),JSON.stringify({providers:{test:{api:'openai-completions',baseUrl:'http://localhost:1/v1',apiKey:'offline',models:[model('default'),model('chosen')]}}}));
  const settings=id=>fs.writeFileSync(path.join(configRoot,'settings.json'),JSON.stringify({defaultProvider:'test',defaultModel:id}));
  settings('default');
  const runtime=new m.PiSessionRuntime(()=>m.loadModelConfiguration(configRoot,configRoot));
  let service,id,value,open,close,input,busy=false;
  try{
    const manager=m.pi.SessionManager.create(f.a,path.join(configRoot,'sessions'));
    manager.appendModelChange('test','chosen');manager.appendMessage({role:'user',content:'history stays intact',timestamp:Date.now()});m.persistManager(manager);
    const ref={kind:'pi',sessionId:manager.getSessionId(),sessionFile:manager.getSessionFile(),cwd:f.a};
    const before=fs.readFileSync(ref.sessionFile);
    if(scope==='project'){
      value={id:'project-open-default',projectId:'p',nativeRef:ref,mcpIds:[],agentSnapshot:null,state:'idle'};id=value.id;
      const {createSessionExecutionService}=require('../src/application/session-execution-service.ts');
      service=createSessionExecutionService({sessions:{get:()=>value,updateRuntime:(_,patch)=>(value={...value,...patch})},projects:{get:()=>({status:'active',rootPath:f.a})},catalog:{},runtime});
      let key=0;open=()=>service.open(id,'open-'+(++key));close=()=>service.close(id);
      input={session:value,workingDirectory:f.a,allowProjectWrite:true,projectSession:true};
    }else{
      const w=await f.service.save(null,{name:'W',projects:[{rootPath:f.a}],defaultProjectIndex:0},'w');
      const s=f.service.createSession(w.id,{},'s');id=s.id;f.repository.bindNative(w.id,id,ref);
      for(const name of ['getHandle','restore','refreshModel','readTree','readRequestEntries','subscribe','close'])f.runtime[name]=runtime[name].bind(runtime);
      f.runtime.isBusy=()=>busy;
      service=f.service;open=()=>service.open(w.id,id);close=()=>runtime.close(runtime.getHandle(id));
      input={session:{...f.repository.session(w.id,id),projectId:w.id,mcpIds:[],agentSnapshot:null},workingDirectory:f.a,allowProjectWrite:true,projectSession:false};
    }
    assert.equal((await open()).status,'ready');
    let h=runtime.getHandle(id);assert.equal(h.session.model.id,'default');
    assert.equal(h.manager.getSessionId(),ref.sessionId);assert.equal(h.manager.getSessionFile(),ref.sessionFile);
    assert(fs.readFileSync(ref.sessionFile).subarray(0,before.length).equals(before));
    const changes=()=>h.manager.getEntries().filter(e=>e.type==='model_change').length;
    let count=changes();await open();assert.equal(changes(),count);
    await runtime.switchModel(input,{provider:'test',modelId:'chosen'});
    assert.equal(h.session.model.id,'chosen');
    // Read-only model inspection preserves the user's selection until another open.
    assert.equal((await runtime.models(input)).current.modelId,'chosen');assert.equal(h.session.model.id,'chosen');
    await open();assert.equal(h.session.model.id,'default');assert.equal(changes(),count+2);
    await runtime.switchModel(input,{provider:'test',modelId:'chosen'});
    const originalBusy=runtime.isBusy.bind(runtime);runtime.isBusy=()=>busy||originalBusy(h);
    busy=true;await open();assert.equal(h.session.model.id,'chosen');busy=false;
    await open();assert.equal(h.session.model.id,'default');
    await runtime.switchModel(input,{provider:'test',modelId:'chosen'});
    settings('missing');count=changes();assert.equal((await open()).status,'unavailable');assert.equal(h.session.model.id,'chosen');assert.equal(changes(),count);
    await close();assert.equal((await open()).status,'unavailable');
    settings('default');assert.equal((await open()).status,'ready');h=runtime.getHandle(id);assert.equal(h.session.model.id,'default');
    assert.equal(m.pi.SessionManager.open(ref.sessionFile).getBranch().filter(e=>e.type==='model_change').at(-1).modelId,'default');
  }finally{
    if(scope==='project'&&service)await service.close(id);
    const h=runtime.getHandle(id);if(h)await runtime.close(h);
    f.close();fs.rmSync(configRoot,{recursive:true,force:true});
  }
});
