require('./register.cjs');
const fs=require('node:fs'),swc=require('next/dist/build/swc'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {test}=require('node:test'),assert=require('node:assert/strict');
require.extensions['.tsx']=function(module,file){const result=swc.transformSync(fs.readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'typescript',tsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});module._compile(result.code,file);};
const {Conversation}=require('../web/workspace/conversation/project-session/conversation.tsx');
function render(running,liveEntries){return renderToStaticMarkup(React.createElement(Conversation,{messages:[],pendingText:'你好',streamingText:'',activities:[],liveEntries,running}));}

test('project session shows an accessible spinner before the first visible entry',()=>{
 const html=render(true,[]);
 assert.match(html,/role="status"/);assert.match(html,/正在思考/);assert.match(html,/class="[^"]*spin/);assert.match(html,/aria-hidden="true"/);
});
test('waiting indicator is hidden after first text, tool activity or completion',()=>{
 assert.doesNotMatch(render(true,[{id:'text',kind:'text',text:'回答'}]),/正在思考/);
 assert.doesNotMatch(render(true,[{id:'tool',kind:'tool',activity:{id:'tool',kind:'tool',state:'running',summary:'read'}}]),/正在思考/);
 assert.doesNotMatch(render(false,[]),/正在思考/);
});
