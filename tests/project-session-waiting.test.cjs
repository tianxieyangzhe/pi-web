require('./register.cjs');
const fs=require('node:fs'),swc=require('next/dist/build/swc'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {JSDOM}=require('jsdom');
const {test}=require('node:test'),assert=require('node:assert/strict');
require.extensions['.tsx']=function(module,file){const result=swc.transformSync(fs.readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'typescript',tsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});module._compile(result.code,file);};
const {Conversation}=require('../web/workspace/conversation/project-session/conversation.tsx');
const entry={id:'persisted',parentId:null,type:'message',timestamp:'now',message:{role:'assistant',content:[{type:'text',text:'已有输出'}]}};
function render(running,temporary=[],entries=[]){return new JSDOM(renderToStaticMarkup(React.createElement(Conversation,{tree:{entries:entries.map(entry=>({entry,label:null,labelTimestamp:null})),activeLeafId:entries.at(-1)?.id??null},pendingText:'',temporary,running})));}
const message=(content,entryId=null)=>({key:'assistant',entryId,events:[{type:'message_update',payload:{message:{role:'assistant',content}}}]});
function checkWaiting(temporary=[],entries=[]){
 const dom=render(true,temporary,entries);
 try{
  const section=dom.window.document.querySelector('section'),statuses=section.querySelectorAll('[role=status]');
  assert.equal(statuses.length,1);const status=statuses[0];assert.equal(status.textContent,'正在等待');assert.equal(section.lastElementChild,status);
  assert.ok(status.querySelector('svg.animate-spin[aria-hidden=true]'));assert.doesNotMatch(section.textContent,/正在思考/);
 }finally{dom.window.close();}
}
test('one accessible waiting indicator stays at the end throughout text, thinking and tool activity',()=>{
 checkWaiting();
 checkWaiting([message([])]);
 checkWaiting([message([{type:'text',text:'正在输出'}])]);
 checkWaiting([message([{type:'thinking',thinking:'分析中'}])]);
 checkWaiting([message([{type:'toolCall',name:'read',arguments:{path:'file'}}])]);
 for(const type of ['tool_execution_start','tool_execution_update','tool_execution_end']){
  checkWaiting([{key:'tool',entryId:null,events:[{type,payload:{toolName:'read',args:{path:'file'},result:{content:'done'}}}]}]);
 }
 checkWaiting([message([{type:'text',text:'已有输出'}],'persisted')],[entry]);
 checkWaiting([],[entry]);
});
test('confirmed completion, failure or interruption hides waiting even when live nodes remain',()=>{
 for(const temporary of [[],[message([{type:'text',text:'最终输出'}])]]){
  const dom=render(false,temporary,[entry]);
  try{assert.equal(dom.window.document.querySelector('[role=status]'),null);assert.doesNotMatch(dom.window.document.body.textContent,/正在等待|正在思考/);}finally{dom.window.close();}
 }
});
