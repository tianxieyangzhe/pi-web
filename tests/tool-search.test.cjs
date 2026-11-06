require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createToolSearchScope,prepareWebFetchArguments}=require('../src/infrastructure/pi/tool-search-scope.ts');
const {createLocalSearchClient,toolSearchConfiguration,publicWebUrl,parseBingResults}=require('../src/infrastructure/pi/tool-search-client.ts');
const html=value=>new Response(value,{headers:{'content-type':'text/html; charset=utf-8'}});
const bing=()=>'<html><body><ol id="b_results"><li class="b_algo"><h2><a href="https://example.com/article">Source</a></h2><div class="b_caption"><p>Original snippet</p></div></li></ol></body></html>';
const dependencies=()=>({readEnvironment:()=>({}),lookup:async()=>[{address:'93.184.216.34',family:4}]});
function fixture(overrides={}){
 const tools={},scope=createToolSearchScope({...dependencies(),...overrides});scope.extension({registerTool:tool=>tools[tool.name]=tool});
 let active=['read','bash','edit','write'];const session={getActiveToolNames:()=>[...active],setActiveToolsByName:names=>{active=[...names];}};
 return {scope,tools,session};
}
test('single web_fetch searches Bing without URL, directly reads pages, limits calls and restores tools without any search key',async()=>{
 const requests=[],f=fixture({fetch:async(url,options)=>{requests.push({url,options});return url.startsWith('https://www.bing.com/search')?html(bing()):new Response('Full original body',{headers:{'content-type':'text/plain'}});}}),other=fixture();
 assert.deepEqual(Object.keys(f.tools),['web_fetch']);assert.equal(f.tools.web_fetch.defaultActive,false);
 await assert.rejects(f.tools.web_fetch.execute('s',{input:'news'}),/未开启/);f.scope.begin(true,f.session);
 assert.deepEqual(f.session.getActiveToolNames(),['read','bash','edit','write','web_fetch']);assert(!other.session.getActiveToolNames().includes('web_fetch'));
 for(const params of [{},{input:''},{input:' '},{input:'x'.repeat(401)}])await assert.rejects(f.tools.web_fetch.execute('x',params));assert.equal(requests.length,0);
 const search=await f.tools.web_fetch.execute('s',{input:'最新新闻',maxResults:3});assert.equal(search.details.results[0].content,'Original snippet');assert.deepEqual(JSON.parse(search.content[0].text),search.details);
 assert.equal(new URL(requests[0].url).origin,'https://www.bing.com');assert.equal(new URL(requests[0].url).searchParams.get('q'),'最新新闻');assert.equal(requests[0].options.method,'GET');assert.equal(requests[0].options.headers.authorization,undefined);
 const page=await f.tools.web_fetch.execute('p',{input:'https://example.com'});assert.equal(page.details.content,'Full original body');assert.equal(requests[1].url,'https://example.com/');
 for(let i=0;i<6;i++)await f.tools.web_fetch.execute('s',{input:'news'});
 await assert.rejects(f.tools.web_fetch.execute('s',{input:'news'}),/8次/);assert.equal(requests.length,8);
 await f.scope.end();assert.deepEqual(f.session.getActiveToolNames(),['read','bash','edit','write']);await assert.rejects(f.tools.web_fetch.execute('x',{input:'q'}),/未开启/);
 f.scope.begin(true,f.session);await f.tools.web_fetch.execute('x',{input:'q'});await f.scope.end();
});
test('web_fetch schema requires a single nonblank input and normalizes legacy mutually supplied fields before validation',async()=>{
 const f=fixture({fetch:async()=>new Response('body',{headers:{'content-type':'text/plain'}})}),tool=f.tools.web_fetch;
 assert.deepEqual(tool.parameters.required,['input']);assert.equal(tool.parameters.properties.url,undefined);assert.equal(tool.parameters.properties.query,undefined);assert.match(tool.description,/Always provide the required input/);
 assert.equal(new RegExp(tool.parameters.properties.input.pattern).test(' '),false);
 for(const [old,expected] of [
  [{url:'https://example.com',query:'news'},{input:'https://example.com'}],
  [{url:'',query:'news'},{input:'news'}],
  [{input:' ',url:' ',query:' news ',maxResults:3},{input:'news',maxResults:3}],
  [{input:'canonical',url:'https://example.com',query:'old'},{input:'canonical'}],
  [{url:null,query:'news'},{input:'news'}],
 ])assert.deepEqual(tool.prepareArguments(old),expected);
 assert.deepEqual(prepareWebFetchArguments({}),{input:''});assert.deepEqual(prepareWebFetchArguments({url:' ',query:''}),{input:''});
 f.scope.begin(true,f.session);try{const result=await tool.execute('id',tool.prepareArguments({url:'https://example.com',query:'ignored'}));assert.equal(result.details.content,'body');}finally{await f.scope.end();}
});

test('Bing parsing decodes source links, skips duplicates and invalid schemes, and reports anti-bot or changed result pages',()=>{
 const encoded='a1'+Buffer.from('https://example.org/source').toString('base64url');
 const result=parseBingResults(bing().replace('</ol>',`<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=${encoded}">Other source</a></h2><p>Other snippet</p></li><li class="b_algo"><h2><a href="javascript:alert(1)">Invalid</a></h2></li></ol>`),'q','https://www.bing.com/search?q=q',5);
 assert.equal(result.results.length,2);assert.equal(result.results[1].url,'https://example.org/source');assert.equal(parseBingResults(bing(),'q','https://www.bing.com/search',1).results.length,1);
 assert.throws(()=>parseBingResults('<form id="captcha"></form>','q','https://www.bing.com/search',5),/验证码/);
 assert.throws(()=>parseBingResults('<html><body>unexpected format</body></html>','q','https://www.bing.com/search',5),/未返回可解析/);
});
test('direct page extraction never executes scripts, validates redirects/DNS, handles response limits, errors and cancellation',async()=>{
 let executed=false;global.__pageScript=()=>{executed=true;};
 const content='<html><head><title>Example Article</title></head><body><nav>Navigation</nav><article><h1>Example Article</h1><p>'+('This is the full original paragraph of a public article. '.repeat(30))+'</p></article><script>globalThis.__pageScript()</script></body></html>';
 let count=0;const client=createLocalSearchClient({}, {...dependencies(),fetch:async()=>++count===1?new Response(null,{status:302,headers:{location:'/article'}}):html(content)});
 try{const page=await client.fetchPage('https://example.com/start');assert.equal(page.url,'https://example.com/article');assert.match(page.content,/full original paragraph/);assert(!page.content.includes('__pageScript'));assert.equal(executed,false);}finally{await client.close();delete global.__pageScript;}
 for(const url of ['file:///etc/passwd','http://localhost','http://127.0.0.1','http://10.0.0.1','http://[::1]','https://user:secret@example.com','https://host.local'])assert.throws(()=>publicWebUrl(url));
 const run=async(fetch,lookup=dependencies().lookup)=>{const c=createLocalSearchClient({}, {fetch,lookup});try{return await c.fetchPage('https://example.com');}finally{await c.close();}};
 await assert.rejects(run(async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1'}})),/公开/);
 let attempted=false;await assert.rejects(run(async()=>{attempted=true;return html(content);},async()=>[{address:'10.0.0.1',family:4}]),/非公开网络/);assert.equal(attempted,false);
 await assert.rejects(run(async()=>new Response('secret',{status:403})),e=>/HTTP 403/.test(e.message)&&!e.message.includes('secret'));
 await assert.rejects(run(async()=>new Response('x',{headers:{'content-type':'application/pdf'}})),/类型不支持/);
 await assert.rejects(run(async()=>new Response('x'.repeat(2*1024*1024+1),{headers:{'content-type':'text/plain'}})),/2MiB/);
 await assert.rejects(run(async()=>{throw Error('proxy password secret');}),e=>!e.message.includes('secret')&&/联网请求失败/.test(e.message));
 const controller=new AbortController(),c=createLocalSearchClient({}, {...dependencies(),fetch:async(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
 const pending=c.fetchPage('https://example.com',controller.signal);await new Promise(resolve=>setImmediate(resolve));controller.abort();try{await assert.rejects(pending,/已取消/);}finally{await c.close();}
});
test('configuration needs no API key, snapshots environment proxies and passes an explicit dispatcher',async()=>{
 assert.deepEqual(toolSearchConfiguration({readEnvironment:()=>({})}),{httpProxy:undefined,httpsProxy:undefined,noProxy:undefined});
 assert.throws(()=>toolSearchConfiguration({readEnvironment:()=>({HTTPS_PROXY:'socks5://localhost:1080'})}),e=>e.code==='TOOL_SEARCH_UNAVAILABLE');
 const config=toolSearchConfiguration({readEnvironment:()=>({http_proxy:'http://localhost:8080',HTTPS_PROXY:'http://localhost:8081',NO_PROXY:'localhost'})});assert.equal(config.httpProxy,'http://localhost:8080');assert.equal(config.httpsProxy,'http://localhost:8081');assert.equal(config.noProxy,'localhost');
 const c=createLocalSearchClient(config,{...dependencies(),fetch:async(_url,options)=>{assert(options.dispatcher);return html(bing());}});try{assert.equal((await c.search('q',5)).results.length,1);}finally{await c.close();}
});

test('real Pi runtime executes search and fetch for Project and Workspace using Chat Completions models, retains results and restores tools',async()=>{
 const pi=await import('@earendil-works/pi-coding-agent'),ai=await import('@earendil-works/pi-ai'),Module=require('node:module'),load=Module._load;
 Module._load=function(spec,...args){return spec==='@earendil-works/pi-coding-agent'?pi:spec==='@earendil-works/pi-ai'?ai:load.call(this,spec,...args);};
 let PiSessionRuntime,initializeSession;try{({PiSessionRuntime}=require('../src/infrastructure/pi/pi-session-runtime.server.ts'));({initializeSession}=require('../src/infrastructure/pi/initialize-session.server.ts'));}finally{Module._load=load;}
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'tool-search-')));
 const credentials={async read(){},async list(){return []},async modify(){},async delete(){}};
 const modelRuntime=await pi.ModelRuntime.create({credentials,modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
 modelRuntime.registerProvider('fixture',{baseUrl:'http://localhost',apiKey:'fake',api:'openai-completions',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1000}]});
 const requests=[],runtime=new PiSessionRuntime(async()=>({runtime:modelRuntime,model:modelRuntime.getModel('fixture','fixture')}),{readEnvironment:()=>({}),lookup:async()=>[{address:'93.184.216.34',family:4}],fetch:async(url,options)=>{requests.push({url,options});return url.startsWith('https://www.bing.com/search')?html(bing()):new Response('Full body',{headers:{'content-type':'text/plain'}});}});
 try{for(const workspace of [true,false]){
  const manager=initializeSession('search-'+workspace,root,root),nativeRef={kind:'pi',sessionId:manager.getSessionId(),sessionFile:manager.getSessionFile(),cwd:root};
  const input={session:{id:'tool-search-'+workspace,nativeRef,agentSnapshot:null,state:'idle'},workingDirectory:root,independentProjectTools:true,allowProjectRead:true,allowProjectWrite:true,...(workspace?{workspace:{id:'w',defaultProjectId:'p',projects:[],prompt:'test'}}:{})};
  let handle;try{handle=await runtime.restore(input);assert(!handle.session.getActiveToolNames().includes('web_fetch'));assert(!handle.session.getAllTools().some(t=>t.name==='web_search'));
   const baseline=handle.session.getActiveToolNames(),loadouts=[];let index=0,fail=false;
   handle.session.agent.streamFunction=()=>{
    loadouts.push(handle.session.getActiveToolNames());const call=[{name:'web_fetch',arguments:{url:' ',query:'test'}},{name:'web_fetch',arguments:{input:'https://example.com'}}][index++];
    const stream=ai.createAssistantMessageEventStream(),message={role:'assistant',content:fail?[]:call?[{type:'toolCall',id:'call-'+index,...call}]:[{type:'text',text:'done'}],api:'openai-completions',provider:'fixture',model:'fixture',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:fail?'error':call?'toolUse':'stop',...(fail?{errorMessage:'test failure'}:{}),timestamp:Date.now()};stream.push(fail?{type:'error',reason:'error',error:message}:{type:'done',reason:message.stopReason,message});stream.end();return stream;
   };
   await runtime.send(handle,'search then read',()=>{},undefined,undefined,true,false,true);
   assert.equal(loadouts.length,3);assert(loadouts.every(names=>names.includes('web_fetch')&&!names.includes('web_search')));assert.deepEqual(handle.session.getActiveToolNames(),baseline);
   const results=handle.manager.getEntries().filter(e=>e.type==='message'&&e.message.role==='toolResult'&&['web_search','web_fetch'].includes(e.message.toolName));assert.equal(results.length,2);assert(results.every(e=>!e.message.isError));assert.match(results[1].message.content[0].text,/Full body/);
   assert(pi.SessionManager.open(nativeRef.sessionFile).getEntries().some(e=>e.type==='message'&&e.message.toolName==='web_fetch'));
   fail=true;await assert.rejects(runtime.send(handle,'failed request',()=>{},undefined,undefined,true,false,true));assert.deepEqual(handle.session.getActiveToolNames(),baseline);
   fail=false;await runtime.send(handle,'plain request',()=>{});assert(!loadouts.at(-1).includes('web_fetch'));
  }finally{if(handle)await runtime.close(handle);}
 }}finally{fs.rmSync(root,{recursive:true,force:true});}
 assert.equal(requests.length,4);
});
