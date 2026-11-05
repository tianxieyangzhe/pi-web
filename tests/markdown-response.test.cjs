require('./register.cjs');
const fs=require('node:fs'),swc=require('next/dist/build/swc');
require.extensions['.tsx']=function(module,file){const result=swc.transformSync(fs.readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'typescript',tsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});module._compile(result.code,file);};
const {test}=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {JSDOM}=require('jsdom');
const {Response}=require('../web/workspace/conversation/ai-elements/response.tsx');
function render(text){return new JSDOM(renderToStaticMarkup(React.createElement(Response,null,text))).window.document;}
test('LCA reply renders bold file link with inline code, Go fence and list without Markdown markers',()=>{
 const text='LCA 的主入口在 **[`src/insa.go:84`](/Users/example/lca/src/insa.go#L84)**：\n\n```go\n// 主函数\nfunc main() {\n```\n\n已查看的启动逻辑包括：\n- 注册 panic 捕获与日志记录。\n- 初始化 SSS 和 `ins.NodeMgr`。';
 const doc=render(text),link=doc.querySelector('strong > a');
 assert(link);assert.equal(link.getAttribute('href'),'/Users/example/lca/src/insa.go#L84');assert.equal(link.querySelector('code').textContent,'src/insa.go:84');
 assert.equal(doc.querySelector('pre > code.language-go').textContent,'// 主函数\nfunc main() {');
 assert.equal(doc.querySelectorAll('ul > li').length,2);assert.equal(doc.querySelector('li code').textContent,'ins.NodeMgr');
 assert(!doc.body.textContent.includes('**'));assert(!doc.body.textContent.includes('```'));assert(!doc.body.textContent.includes(']('));
});
test('clicking nested local file links invokes preview and prevents navigation; external links remain external',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 const keys=['window','document','Node','HTMLElement'];const before=Object.fromEntries(keys.map(key=>[key,global[key]]));
 for(const key of keys)global[key]=dom.window[key];global.IS_REACT_ACT_ENVIRONMENT=true;
 const {createRoot}=require('react-dom/client'),{act}=React;
 const {SessionConversationView}=require('../web/workspace/conversation/session-conversation-view.tsx');
 const calls=[],root=createRoot(document.getElementById('root'));
 const session={sessionId:'s',tree:{entries:[{entry:{id:'a',type:'message',message:{role:'assistant',content:[{type:'text',text:'**[`insa.go:84`](/repo/lca/insa.go#L84)** [external](https://example.com)'}]}}}],activeLeafId:'a'},temporary:[],pendingText:'',running:false,ready:true,error:'',retryOpen(){},send:async()=>{},interrupt:async()=>{},end:async()=>{},stopping:false,compacting:false};
 try{
  await act(async()=>root.render(React.createElement(SessionConversationView,{title:'Work',session,onOpenFileLink:href=>calls.push(href)})));
  const event=new window.MouseEvent('click',{bubbles:true,cancelable:true});
  document.querySelector('a code').dispatchEvent(event);
  assert.equal(event.defaultPrevented,true);assert.deepEqual(calls,['/repo/lca/insa.go#L84']);
  const external=document.querySelector('a[href="https://example.com"]');assert.equal(external.target,'_blank');assert.equal(calls.length,1);
  const {FilePreviewPane}=require('../web/workspace/files/file-browser.tsx');let scrolled;
  window.HTMLElement.prototype.scrollIntoView=function(){scrolled=this.getAttribute('data-line');};
  await act(async()=>root.render(React.createElement(FilePreviewPane,{projectName:'LCA',rootPath:'/repo/lca',preview:{path:'insa.go',content:'first\nsecond\nthird',size:18},line:2,onClose(){}})));
  assert.equal(scrolled,'2');assert(document.querySelector('[data-line="2"]').className.includes('bg-amber-100'));assert.equal(document.querySelector('pre').textContent,'first\nsecond\nthird');
 }finally{await act(async()=>root.unmount());dom.window.close();for(const key of keys){if(before[key]===undefined)delete global[key];else global[key]=before[key];}delete global.IS_REACT_ACT_ENVIRONMENT;}
});
test('nested inline styles keep HTML inert and reject unsafe link protocols',()=>{
 const doc=render('**[unsafe](javascript:alert)** **<script>alert(1)</script>** [**bold** and `code`](https://example.com)');
 assert.equal(doc.querySelectorAll('a').length,1);assert.equal(doc.querySelector('a').getAttribute('href'),'https://example.com');
 assert.equal(doc.querySelector('a strong').textContent,'bold');assert.equal(doc.querySelector('a code').textContent,'code');
 assert.equal(doc.querySelectorAll('script').length,0);assert(doc.body.textContent.includes('<script>alert(1)</script>'));
 assert.equal(doc.querySelector('a').getAttribute('rel'),'noreferrer noopener');
});
