require('./register.cjs');
const fs=require('node:fs'),swc=require('next/dist/build/swc');
require.extensions['.tsx']=function(module,file){const result=swc.transformSync(fs.readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'typescript',tsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});module._compile(result.code,file);};
const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),React=require('react'),{act}=React;
test('shared conversation scrolls after selection, delayed history and submit; follows growth but preserves reading position until reselected',async()=>{
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost'});
 for(const key of ['window','document','Node','HTMLElement','File','FileReader'])global[key]=dom.window[key];global.IS_REACT_ACT_ENVIRONMENT=true;
 let height=1000,resize,disconnected=false;const tops=new WeakMap();
 Object.defineProperties(HTMLElement.prototype,{scrollHeight:{configurable:true,get:()=>height},clientHeight:{configurable:true,get:()=>200},scrollTop:{configurable:true,get(){return tops.get(this)??0;},set(value){tops.set(this,Math.max(0,Math.min(value,height-200)));}}});
 global.ResizeObserver=class{constructor(callback){resize=callback;}observe(){}disconnect(){disconnected=true;}};
 const {createRoot}=require('react-dom/client'),{SessionConversationView}=require('../web/workspace/conversation/session-conversation-view.tsx');
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container),sent=[];
 let props={title:'test',scrollRevision:0,session:{sessionId:'first',tree:{entries:[],activeLeafId:null},temporary:[],pendingText:'',running:false,ready:true,error:'',connection:'open',stopping:false,compacting:false,retryOpen(){},async send(text){sent.push(text);},async interrupt(){},async end(){}}};
 const render=()=>act(async()=>root.render(React.createElement(SessionConversationView,props)));
 const viewport=()=>container.querySelector('main.surface > div');
 const up=async()=>act(async()=>{viewport().scrollTop=0;viewport().dispatchEvent(new window.Event('scroll',{bubbles:true}));});
 try{
  await render();assert.equal(viewport().scrollTop,800);
  height=1400;props={...props,session:{...props.session,tree:{entries:[{entry:{type:'message',id:'u',parentId:null,timestamp:new Date().toISOString(),message:{role:'user',content:'history'}}}],activeLeafId:'u'}}};await render();assert.equal(viewport().scrollTop,1200);
  await up();height=1800;props={...props,session:{...props.session,temporary:[]}};await render();assert.equal(viewport().scrollTop,0);resize();assert.equal(viewport().scrollTop,0);
  props={...props,scrollRevision:props.scrollRevision+1};await render();assert.equal(viewport().scrollTop,1600,'clicking the current session resumes bottom follow');
  height=2000;resize();assert.equal(viewport().scrollTop,1800,'late image/content growth follows while at bottom');
  await up();props={...props,session:{...props.session,sessionId:'second',tree:{entries:[],activeLeafId:null}}};await render();assert.equal(viewport().scrollTop,1800);
  await up();const editor=container.querySelector('[role=textbox]');
  await act(async()=>{editor.textContent='new task';editor.dispatchEvent(new window.Event('input',{bubbles:true}));});assert.equal(viewport().scrollTop,0,'typing does not interrupt reading');
  await act(async()=>container.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  assert.deepEqual(sent,['new task']);assert.equal(viewport().scrollTop,1800,'submitting jumps to bottom');
  height=2400;props={...props,session:{...props.session,pendingText:'new task',running:true}};await render();assert.equal(viewport().scrollTop,2200);
 }finally{await act(async()=>root.unmount());assert.equal(disconnected,true);container.remove();dom.window.close();delete global.ResizeObserver;}
});
