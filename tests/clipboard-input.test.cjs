require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {clipboardFiles,pastedLineCount,validateAttachments}=require('../web/workspace/conversation/clipboard.ts');
const clipboard=text=>({items:[],getData:()=>text});
test('short text uses native paste; long text retains exact bytes and displays line count',async()=>{
 assert.equal(clipboardFiles(clipboard('hello\nworld')),null);
 assert.equal(clipboardFiles(clipboard('a'.repeat(1000))),null);
 const text=Array.from({length:11},(_,i)=>`行 ${i}`).join('\r\n');
 const [file]=clipboardFiles(clipboard(text));assert.equal(file.name,'已粘贴 11 行.txt');assert.equal(await file.text(),text);
 assert.equal(pastedLineCount('a\rb\r\nc\n'),4);
 assert.equal(clipboardFiles(clipboard('x'.repeat(1001)))[0].name,'已粘贴 1 行.txt');
});
test('clipboard image preserves bytes; rejects unsupported types and unreadable images',async()=>{
 const file=new File([new Uint8Array([137,80,78,71,13,10,26,10])],'image.png',{type:'image/png'});
 const data={items:[{kind:'file',type:file.type,getAsFile:()=>file}],getData:()=> 'ignored'};
 const [image]=clipboardFiles(data);assert.equal(image.type,'image/png');assert.deepEqual(await image.arrayBuffer(),await file.arrayBuffer());
 assert.throws(()=>clipboardFiles({...data,items:[{kind:'file',type:'image/svg+xml',getAsFile:()=>new File(['svg'],'a.svg',{type:'image/svg+xml'})}]}),/只支持/);
 assert.throws(()=>clipboardFiles({...data,items:[{kind:'file',type:'image/png',getAsFile:()=>null}]}),/无法读取/);
});
test('paste respects combined attachment count and byte limits',()=>{
 const small=new File(['x'],'x.txt');assert.throws(()=>validateAttachments([small],10),/10/);
 assert.throws(()=>validateAttachments([new File([new Uint8Array(2*1024*1024+1)],'large')],0),/2 MiB/);
 const full=new File([new Uint8Array(2*1024*1024)],'full');assert.throws(()=>validateAttachments(Array(5).fill(full),0),/8 MiB/);
 validateAttachments(Array(4).fill(full),6);
});
