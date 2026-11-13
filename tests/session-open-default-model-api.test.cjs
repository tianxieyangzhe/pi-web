require('./register.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
async function modules(){
  const pi=await import('@earendil-works/pi-coding-agent'),ai=await import('@earendil-works/pi-ai'),original=Module._load;
  Module._load=function(spec,...args){if(spec==='@earendil-works/pi-coding-agent')return pi;if(spec==='@earendil-works/pi-ai')return ai;return original.call(this,spec,...args);};
  try{return {pi,...require('../src/infrastructure/pi/model-config.server.ts'),...require('../src/infrastructure/pi/pi-session-runtime.server.ts'),...require('../src/infrastructure/pi/session-artifacts.server.ts')};}finally{Module._load=original;}
}
for(const scope of ['project','workspace'])for(const fresh of [false,true])test(`${scope} open ${fresh?'initializes from current defaults once':'preserves saved model and thinking'} across default changes and unavailable selections`,async()=>{
  const m=await modules(),{fixture}=require('./workspace-fixture.cjs'),f=fixture();
  f.a=fs.realpathSync(f.a);
  const configRoot=fs.mkdtempSync(path.join(os.tmpdir(),'open-default-api-'));
  const model=id=>({id,name:id,reasoning:true,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:64000,maxTokens:1234});
  const models=(ids=['default','chosen'])=>fs.writeFileSync(path.join(configRoot,'models.json'),JSON.stringify({providers:{test:{api:'openai-completions',baseUrl:'http://localhost:1/v1',apiKey:'offline',models:ids.map(model)}}}));
  const settings=(id,enabledModels=['test/*'])=>fs.writeFileSync(path.join(configRoot,'settings.json'),JSON.stringify({defaultProvider:'test',defaultModel:id,enabledModels}));
  models();settings('default');
  const runtime=new m.PiSessionRuntime(()=>m.loadModelConfiguration(configRoot,configRoot));
  // Keep initialization inside temporary files while exercising the application open API.
  runtime.initializeProject=async(input,commit)=>{
    const manager=m.pi.SessionManager.create(f.a,path.join(configRoot,'sessions'));m.persistManager(manager);
    const ref={kind:'pi',sessionId:manager.getSessionId(),sessionFile:manager.getSessionFile(),cwd:f.a};
    const handle=await runtime.restore({...input,session:{...input.session,nativeRef:ref}});commit(ref);return handle;
  };
  let service,id,value,open,close,readValue,busy=false;
  try{
    let savedRef=null;
    if(!fresh){
      const manager=m.pi.SessionManager.create(f.a,path.join(configRoot,'sessions'));
      manager.appendModelChange('test','chosen');manager.appendThinkingLevelChange('high');manager.appendMessage({role:'user',content:'history stays intact',timestamp:Date.now()});m.persistManager(manager);
      savedRef={kind:'pi',sessionId:manager.getSessionId(),sessionFile:manager.getSessionFile(),cwd:f.a};
    }
    if(scope==='project'){
      value={id:`project-open-${fresh}`,projectId:'p',nativeRef:savedRef,mcpIds:[],agentSnapshot:null,state:'idle'};id=value.id;
      const {createSessionExecutionService}=require('../src/application/session-execution-service.ts');
      service=createSessionExecutionService({sessions:{get:()=>value,updateRuntime:(_,patch)=>(value={...value,...patch}),setNativeRefIfAbsent:(_,ref)=>(value={...value,nativeRef:value.nativeRef??ref})},projects:{get:()=>({status:'active',rootPath:f.a})},catalog:{},runtime});
      let key=0;open=()=>service.open(id,'open-'+(++key));close=()=>service.close(id);readValue=()=>value;
    }else{
      const w=await f.service.save(null,{name:'W',projects:[{rootPath:f.a}],defaultProjectIndex:0},'w');
      const s=f.service.createSession(w.id,{},'s');id=s.id;if(savedRef)f.repository.bindNative(w.id,id,savedRef);
      for(const name of ['getHandle','initializeProject','restore','refreshModel','readTree','readRequestEntries','subscribe','close'])f.runtime[name]=runtime[name].bind(runtime);
      f.runtime.isBusy=()=>busy;
      service=f.service;open=()=>service.open(w.id,id);close=()=>runtime.close(runtime.getHandle(id));readValue=()=>f.repository.session(w.id,id);
    }
    const original=savedRef?fs.readFileSync(savedRef.sessionFile):null;
    assert.equal((await open()).status,'ready');
    let h=runtime.getHandle(id);const ref=readValue().nativeRef;
    const input={session:{...readValue(),projectId:'p',mcpIds:[],agentSnapshot:null},workingDirectory:f.a,allowProjectWrite:true,projectSession:scope==='project'};
    assert.equal(h.session.model.id,fresh?'default':'chosen');if(!fresh)assert.equal(h.session.thinkingLevel,'high');
    if(original)assert(fs.readFileSync(ref.sessionFile).subarray(0,original.length).equals(original));
    await runtime.switchModel(input,{provider:'test',modelId:'chosen',thinkingLevel:'high'});
    const preserved=fs.readFileSync(ref.sessionFile),changes=()=>h.manager.getEntries().filter(e=>e.type==='model_change').length;
    let count=changes();
    for(const defaultId of ['default','missing','chosen']){settings(defaultId);assert.equal((await open()).status,'ready');assert.equal(h.session.model.id,'chosen');assert.equal(h.session.thinkingLevel,'high');assert.equal(changes(),count);}
    await close();settings('missing');assert.equal((await open()).status,'ready');h=runtime.getHandle(id);
    assert.equal(h.session.model.id,'chosen');assert.equal(h.session.thinkingLevel,'high');assert.equal(h.manager.getSessionId(),ref.sessionId);assert.equal(h.manager.getSessionFile(),ref.sessionFile);
    assert.deepEqual(fs.readFileSync(ref.sessionFile),preserved);
    // A valid default cannot silently replace a filtered or removed current model.
    settings('default',['test/default']);assert.equal((await open()).status,'unavailable');assert.equal(h.session.model.id,'chosen');assert.deepEqual(fs.readFileSync(ref.sessionFile),preserved);
    await close();assert.equal((await open()).status,'unavailable');assert.equal(runtime.getHandle(id),undefined);assert.deepEqual(fs.readFileSync(ref.sessionFile),preserved);
    settings('default');models(['default']);assert.equal((await open()).status,'unavailable');assert.deepEqual(fs.readFileSync(ref.sessionFile),preserved);
    models();assert.equal((await open()).status,'ready');h=runtime.getHandle(id);assert.equal(h.session.model.id,'chosen');assert.equal(h.session.thinkingLevel,'high');assert.deepEqual(fs.readFileSync(ref.sessionFile),preserved);
    // Default changes also leave a busy session untouched.
    const originalBusy=runtime.isBusy.bind(runtime);runtime.isBusy=()=>busy||originalBusy(h);busy=true;settings('default');await open();assert.equal(h.session.model.id,'chosen');busy=false;
  }finally{
    if(scope==='project'&&service)await service.close(id);
    const h=runtime.getHandle(id);if(h)await runtime.close(h);
    f.close();fs.rmSync(configRoot,{recursive:true,force:true});
  }
});
