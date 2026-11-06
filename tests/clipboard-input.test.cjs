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
test('clipboard preserves ordinary files, mixed images and files, and files-only fallback',async()=>{
 const text=new File(['文件内容\r\n第二行'],'说明.md',{type:'text/markdown'});
 const image=new File([new Uint8Array([137,80,78,71,13,10,26,10])],'截图.png',{type:'image/png'});
 const data={items:[text,image].map(file=>({kind:'file',type:file.type,getAsFile:()=>file})),files:[text,image],getData:()=> '文件名不应替代内容'};
 const files=clipboardFiles(data);assert.deepEqual(files,[text,image]);assert.equal(files[0].name,'说明.md');assert.equal(files[1].name,'截图.png');assert.equal(await files[0].text(),'文件内容\r\n第二行');
 assert.deepEqual(clipboardFiles({...data,items:[]}),[text,image]);
 assert.deepEqual(clipboardFiles({...data,items:[data.items[0]],files:[text]}),[text]);
 assert.throws(()=>clipboardFiles({...data,items:[{kind:'file',type:'',getAsFile:()=>null}]}),/无法读取/);
});
test('paste respects combined attachment count and byte limits',()=>{
 const small=new File(['x'],'x.txt');assert.throws(()=>validateAttachments([small],10),/10/);
 const file=size=>({name:'size.txt',size});
 assert.throws(()=>validateAttachments([file(50_000_000)],0),/50 MB/);
 validateAttachments([file(49_999_999)],0);
 validateAttachments([file(25_000_000),file(25_000_000)],0);
 assert.throws(()=>validateAttachments([file(25_000_000),file(25_000_001)],0),/50 MB/);
 validateAttachments(Array(4).fill(file(3*1024*1024)),6);
});
