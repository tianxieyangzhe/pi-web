require('./register.cjs');
const fs=require('node:fs'),swc=require('next/dist/build/swc');
require.extensions['.tsx']=function(module,file){const result=swc.transformSync(fs.readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'typescript',tsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});module._compile(result.code,file);};
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),{act}=require('react');
let dom,createRoot,PromptInput;
before(()=>{
 dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost'});
 for(const key of ['window','document','Node','HTMLElement','File','FileReader'])global[key]=dom.window[key];
 global.IS_REACT_ACT_ENVIRONMENT=true;
 URL.createObjectURL=()=> 'blob:test';URL.revokeObjectURL=()=>{};
 ({createRoot}=require('react-dom/client'));({PromptInput}=require('../web/workspace/conversation/prompt-input.tsx'));
});
after(()=>dom.window.close());
async function harness(onSubmit,projects=[]){ 
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);let key=crypto.randomUUID();
 async function render(){await act(async()=>root.render(require('react').createElement(PromptInput,{placeholder:'输入',running:false,draftKey:key,onSubmit,referenceProjects:projects})));}
 await render();
 return {container,editor:()=>container.querySelector('[role=textbox]'),async close(){await act(async()=>root.unmount());container.remove();},async switch(){key=crypto.randomUUID();await render();}};
}
async function type(editor,text){await act(async()=>{editor.textContent=text;editor.dispatchEvent(new window.Event('input',{bubbles:true}));});}
function caret(editor,node,offset,end=offset){editor.focus();const range=document.createRange();range.setStart(node,offset);range.setEnd(node,end);window.getSelection().removeAllRanges();window.getSelection().addRange(range);}
async function paste(editor,text,images=[]){await act(async()=>{const event=new window.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{items:images.map(file=>({kind:'file',type:file.type,getAsFile:()=>file})),getData:()=>text}});editor.dispatchEvent(event);});}
async function submit(h){
 await act(async()=>h.container.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
 for(let i=0;i<100 && h.editor().getAttribute('aria-disabled')==='true';i++) await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});
 assert.equal(h.editor().getAttribute('aria-disabled'),'false');
}
test('choosing each search mode returns focus and the saved caret to the composer without sending or changing the draft',async()=>{
 const sent=[],h=await harness((...args)=>sent.push(args));
 try{
  const editor=h.editor();await type(editor,'left right');caret(editor,editor.firstChild,5);
  const select=h.container.querySelector('select[aria-label="联网搜索"]');
  for(const mode of ['tool','none','builtin']){
   await act(async()=>{select.focus();select.value=mode;select.dispatchEvent(new window.Event('change',{bubbles:true}));});
   assert.equal(document.activeElement,editor);assert.equal(window.getSelection().anchorNode,editor.firstChild);assert.equal(window.getSelection().anchorOffset,5);assert.equal(editor.textContent,'left right');assert.equal(select.value,mode);assert.equal(sent.length,0);
  }
  await paste(editor,'insert ');assert.equal(editor.textContent,'left insert right');
 }finally{await h.close();}
});

test('long paste replaces selection with a chip at the caret; surrounding text remains editable and exact material is sent',async()=>{
 const sent=[],h=await harness((content,refs)=>sent.push({content,refs}));
 try{
  const editor=h.editor();await type(editor,'before REPLACE after');caret(editor,editor.firstChild,7,14);
  const text=Array(12).fill('完整原文').join('\r\n');await paste(editor,text);
  const chip=editor.querySelector('[data-attachment-id]');assert.ok(chip);assert.equal(chip.contentEditable,'false');assert.match(chip.textContent,/已粘贴 12 行/);
  assert.equal(editor.firstChild.textContent,'before ');assert.equal(editor.lastChild.textContent,' after');
  assert.equal(h.container.querySelector('.reference-picker__selected'),null);
  await paste(editor,'next');assert.match(editor.textContent,/next after$/);
  await submit(h);assert.equal(sent[0].content,'before next after');assert.equal(Buffer.from(sent[0].refs[0].data,'base64').toString(),text);
  assert.equal(editor.textContent,'');
 }finally{await h.close();}
});
test('DOM paste submits the same complete image and file snapshots as the upload button',async()=>{
 const sent=[],h=await harness((content,refs)=>sent.push({content,refs}));
 try{
  const bytes=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3]);
  const files=[new File([bytes],'截图.png',{type:'image/png'}),new File(['完整文件\r\n第二行'],'说明.md',{type:'text/markdown'})];
  await paste(h.editor(),'clipboard names',files);assert.equal(h.editor().querySelectorAll('[data-attachment-id]').length,2);
  await submit(h);
  await act(async()=>{
   const input=h.container.querySelector('input[type=file]');Object.defineProperty(input,'files',{configurable:true,value:files});input.dispatchEvent(new window.Event('change',{bubbles:true}));
  });
  await submit(h);assert.equal(sent.length,2);assert.deepEqual(sent[0],sent[1]);
  assert.equal(sent[0].refs[0].name,'截图.png');assert.deepEqual(Buffer.from(sent[0].refs[0].data,'base64'),Buffer.from(bytes));
  assert.equal(Buffer.from(sent[0].refs[1].data,'base64').toString(),'完整文件\r\n第二行');
 }finally{await h.close();}
});
test('images and uploaded files use the saved input cursor; remove button and keyboard deletion remove send material',async()=>{
 const sent=[],h=await harness((content,refs)=>sent.push({content,refs}));
 try{
  const editor=h.editor();await type(editor,'left right');caret(editor,editor.firstChild,5);
  const image=new File([new Uint8Array([137,80,78,71,13,10,26,10])],'img.png',{type:'image/png'});
  await paste(editor,'',[image]);assert.equal(editor.querySelectorAll('img').length,1);
  await act(async()=>editor.querySelector('button').click());assert.equal(editor.querySelector('[data-attachment-id]'),null);
  caret(editor,editor.firstChild,2);editor.dispatchEvent(new window.FocusEvent('blur',{bubbles:true}));
  await act(async()=>{
    h.container.querySelector('.reference-picker__trigger').focus();
    const fileInput=h.container.querySelector('input[type=file]');Object.defineProperty(fileInput,'files',{configurable:true,value:[new File(['data'],'file.txt',{type:'text/plain'})]});
    fileInput.dispatchEvent(new window.Event('change',{bubbles:true}));
  });
  const chip=editor.querySelector('[data-attachment-id]');assert.equal(editor.firstChild.textContent,'le');assert.match(chip.textContent,/file.txt/);
  await act(async()=>{chip.remove();editor.dispatchEvent(new window.Event('input',{bubbles:true}));});
  await submit(h);assert.equal(sent[0].content,'left right');assert.deepEqual(sent[0].refs,[]);
 }finally{await h.close();}
});
test('attachments have real caret stops on both sides, arrows cross one unit and insertion finishes after the block',async()=>{
 const sent=[],h=await harness((content,refs)=>sent.push({content,refs}));
 try {
  const editor=h.editor();await paste(editor,'a'.repeat(1001));
  const chip=editor.querySelector('[data-attachment-id]'),before=chip.previousSibling,after=chip.nextSibling;
  assert.equal(chip.getAttribute('contenteditable'),'false');assert.ok(before.hasAttribute('data-caret-slot'));assert.ok(after.hasAttribute('data-caret-slot'));
  const selection=window.getSelection();assert.equal(selection.anchorNode,after);assert.equal(selection.anchorOffset,after.childNodes.length);
  async function key(name){await act(async()=>editor.dispatchEvent(new window.KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true})));}
  await key('ArrowLeft');assert.equal(selection.anchorNode,before);
  await key('ArrowRight');assert.equal(selection.anchorNode,after);
  await act(async()=>chip.click());assert.equal(selection.anchorNode,after);
  await paste(editor,'tail');
  await submit(h);assert.equal(sent[0].content,'tail');assert.equal(sent[0].refs.length,1);assert.equal(sent[0].content.includes('\u200B'),false);
 }finally{await h.close();}
});
test('Backspace and Delete remove an entire candidate without editing its label or leaking caret sentinels',async()=>{
 const h=await harness(()=>{});
 try {
  const editor=h.editor();await paste(editor,'x'.repeat(1001));
  await act(async()=>editor.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Backspace',bubbles:true,cancelable:true})));
  assert.equal(editor.querySelector('[data-attachment-id]'),null);assert.equal(editor.textContent,'');
  await paste(editor,'y'.repeat(1001));
  const chip=editor.querySelector('[data-attachment-id]');caret(editor,chip.previousSibling,0);
  await act(async()=>editor.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true})));
  assert.equal(editor.querySelector('[data-attachment-id]'),null);assert.equal(editor.textContent,'');
 }finally{await h.close();}
});
test('consecutive candidates remain separate and arrow navigation does not skip a candidate',async()=>{
 const h=await harness(()=>{});
 try {
  const editor=h.editor();await paste(editor,'first'.repeat(201));await paste(editor,'second'.repeat(201));
  const chips=editor.querySelectorAll('[data-attachment-id]');assert.equal(chips.length,2);
  const selection=window.getSelection();
  for (const chip of [chips[1],chips[0]]) {
    await act(async()=>editor.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true})));
    assert.equal(selection.anchorNode,chip.previousSibling);
  }
 }finally{await h.close();}
});
test('Shift+Enter inserts one newline at the caret and IME confirmation does not submit',async()=>{
 const sent=[],h=await harness((content,refs)=>sent.push({content,refs}));
 try{
  const editor=h.editor();await type(editor,'ab');caret(editor,editor.firstChild,1);
  await act(async()=>editor.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true})));
  assert.equal(editor.textContent,'a\nb');
  await act(async()=>editor.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})));
  assert.equal(sent.length,0);await submit(h);assert.equal(sent[0].content,'a\nb');
 }finally{await h.close();}
});
test('replacing a selected attachment sends only the replacement material',async()=>{
 const sent=[],h=await harness((content,refs)=>sent.push({content,refs}));
 try {
  const editor=h.editor();await paste(editor,'first'.repeat(201));const chip=editor.querySelector('[data-attachment-id]');
  const selected=document.createRange();selected.selectNode(chip);window.getSelection().removeAllRanges();window.getSelection().addRange(selected);
  await paste(editor,'second'.repeat(201));assert.equal(editor.querySelectorAll('[data-attachment-id]').length,1);
  await submit(h);assert.equal(sent[0].refs.length,1);assert.equal(Buffer.from(sent[0].refs[0].data,'base64').toString(),'second'.repeat(201));
 }finally{await h.close();}
});
test('project-file dialog inserts at the saved cursor rather than below the editor',async()=>{
 const {api}=require('../web/api/client.ts'),previous=api.listFiles;
 api.listFiles=async()=>({entries:[{name:'note.txt',path:'note.txt',type:'file'}],truncated:false});
 window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'));};
 const sent=[],h=await harness((content,refs)=>sent.push({content,refs}),[{id:'p',name:'P',status:'active'}]);
 try {
  const editor=h.editor();await type(editor,'left right');caret(editor,editor.firstChild,5);
  await act(async()=>h.container.querySelectorAll('.reference-picker__trigger')[1].click());
  await act(async()=>h.container.querySelector('dialog input[type=checkbox]').click());
  const chip=editor.querySelector('[data-attachment-id]');assert.ok(chip);assert.match(chip.textContent,/note.txt/);assert.equal(editor.firstChild.textContent,'left ');
  await submit(h);assert.deepEqual(sent[0].refs,[{projectId:'p',path:'note.txt'}]);assert.equal(sent[0].content,'left right');
 }finally{await h.close();api.listFiles=previous;}
});
test('failure restores inline content and attachment; changing sessions does not expose old material',async()=>{
 let reject=true;const sent=[],h=await harness((content,refs)=>{sent.push({content,refs});if(reject)throw Error('rejected');});
 try{
  const editor=h.editor();await paste(editor,'x'.repeat(1001));await submit(h);
  assert.match(editor.textContent,/已粘贴 1 行/);assert.ok(editor.querySelector('[data-attachment-id]'));
  reject=false;await submit(h);assert.equal(sent.length,2);assert.equal(editor.textContent,'');
  await paste(editor,'y'.repeat(1001));await h.switch();assert.equal(h.editor().textContent,'');await submit(h);assert.equal(sent.length,2);
 }finally{await h.close();}
});
