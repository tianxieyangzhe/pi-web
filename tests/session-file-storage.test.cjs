require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {zipSync,strToU8}=require('fflate');
const {storeSessionFile,sessionFileDirectory,readableSessionFile}=require('../src/infrastructure/references/session-files.server.ts');
const {documentText}=require('../src/infrastructure/references/document-text.server.ts');
const {parseMessageReferences}=require('../src/domain/message-references.ts');
const {appendMessageReferences}=require('../src/infrastructure/pi/message-references.server.ts');
function fixture(){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'session-files-')));return {root,store:path.join(root,'files'),close(){fs.rmSync(root,{recursive:true,force:true});}};}
const data=text=>Buffer.from(text).toString('base64');
const office=(entries)=>Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([key,value])=>[key,strToU8(value)]))));

test('all non-image uploads remain files regardless of size; image bytes remain native images',()=>{
 for(const name of ['a.md','a.txt','a.log'])for(const body of ['short','x'.repeat(2*1024*1024+1)]){
  const [file]=parseMessageReferences([{name,data:data(body)}]);assert.equal(file.type,'file');assert.equal(Buffer.from(file.data,'base64').toString(),body);assert.equal(file.text,undefined);
 }
 const doc=office({'word/document.xml':'<w:document><w:p><w:t>word</w:t></w:p></w:document>'});assert.equal(parseMessageReferences([{name:'a.docx',data:doc.toString('base64')}])[0].type,'file');
 const ole=Buffer.from([208,207,17,224,161,177,26,225]);for(const ext of ['doc','xls','ppt'])assert.equal(parseMessageReferences([{name:'a.'+ext,data:ole.toString('base64')}])[0].type,'file');
 assert.equal(parseMessageReferences([{name:'a.pdf',data:data('%PDF-1.7\n')}])[0].type,'file');
 assert.throws(()=>parseMessageReferences([{name:'program.exe',data:Buffer.from([0,1,255]).toString('base64')}]),e=>e.code==='BINARY_FILE');
 assert.equal(parseMessageReferences([{name:'image.png',data:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')}])[1].type,'image');
});

test('session storage preserves bytes, deduplicates, survives reopening and refuses corrupted originals',()=>{
 const f=fixture();try{
  const a=storeSessionFile('first','notes.md',data('original\r\n完整内容'),f.store);
  assert.equal(fs.readFileSync(a.originalPath,'utf8'),'original\r\n完整内容');assert.equal(a.readPath,a.originalPath);
  assert.deepEqual(storeSessionFile('first','notes.md',data('original\r\n完整内容'),f.store),a);
  assert.notEqual(storeSessionFile('first','notes.md',data('changed'),f.store).originalPath,a.originalPath);
  assert.notEqual(storeSessionFile('second','notes.md',data('original\r\n完整内容'),f.store).originalPath,a.originalPath);
  assert.equal(fs.statSync(a.originalPath).mode&0o777,0o400);
  fs.chmodSync(a.originalPath,0o600);fs.writeFileSync(a.originalPath,'tampered');
  assert.throws(()=>storeSessionFile('first','notes.md',data('original\r\n完整内容'),f.store),e=>e.code==='REFERENCE_STORE_FAILED');
 }finally{f.close();}
});

test('Office extraction preserves paragraphs, slide order and cell coordinates without running document code',()=>{
 const examples=[
  ['a.docx',{'word/document.xml':'<w:document><w:p><w:r><w:t>Word段落</w:t></w:r></w:p></w:document>'},/Word段落/],
  ['a.xlsx',{'xl/sharedStrings.xml':'<sst><si><t>表格文字</t></si></sst>','xl/worksheets/sheet1.xml':'<worksheet><row><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v></c></row></worksheet>'},/A1=表格文字\tB1=42/],
  ['a.pptx',{'ppt/slides/slide2.xml':'<p:sld><a:p><a:t>第二页</a:t></a:p></p:sld>','ppt/slides/slide1.xml':'<p:sld><a:p><a:t>第一页</a:t></a:p></p:sld>'},/第一页[\s\S]*第二页/],
  ['a.odt',{'content.xml':'<office:document><text:p>ODF正文</text:p></office:document>'},/ODF正文/]
 ];
 for(const [name,entries,expected] of examples){const bytes=office(entries),result=documentText(name,bytes);assert.match(result.text,expected);const f=fixture();try{const stored=storeSessionFile('session',name,bytes.toString('base64'),f.store);assert.match(fs.readFileSync(stored.readPath,'utf8'),expected);assert.deepEqual(fs.readFileSync(stored.originalPath),bytes);}finally{f.close();}}
 const invalid=documentText('broken.docx',Buffer.from('not zip'));assert.equal(invalid.text,undefined);assert.match(invalid.note,/提取失败/);
 const bomb=office({'word/document.xml':'<w:p>data</w:p>'}),central=bomb.indexOf(Buffer.from([80,75,1,2]));bomb.writeUInt32LE(50_000_001,central+24);assert.match(documentText('huge.docx',bomb).note,/超过50MB/);
 assert.match(documentText('old.doc',Buffer.from('binary')).note,/需要/);
});

test('Pi reference messages contain file locations rather than content or base64',async()=>{
 const f=fixture();try{
  let written;const file={name:'note.txt',data:data('SECRET_UPLOAD_BODY')};
  await appendMessageReferences({sessionId:'native-session',sendCustomMessage:async message=>{written=message;}},parseMessageReferences([file]),'turn',f.store);
  const payload=JSON.stringify(written);assert.match(payload,/readPath/);assert.match(payload,/使用 read/);assert.doesNotMatch(payload,/project_read/);assert.doesNotMatch(payload,/SECRET_UPLOAD_BODY|U0VDUkVUX1VQTE9BRF9CT0RZ/);assert(written.content.every(block=>block.type==='text'));
  assert.equal(fs.readFileSync(storeSessionFile('native-session',file.name,file.data,f.store).readPath,'utf8'),'SECRET_UPLOAD_BODY');
 }finally{f.close();}
});

test('read-only file access rejects other sessions and symlinks',async()=>{
 const f=fixture();try{
  const a=storeSessionFile('a','a.txt',data('A'),f.store),b=storeSessionFile('b','b.txt',data('B'),f.store),scope=sessionFileDirectory('a',f.store);
  assert.equal(await readableSessionFile(a.readPath,scope),a.readPath);await assert.rejects(()=>readableSessionFile(b.readPath,scope));
  const link=path.join(scope,'link');fs.symlinkSync(b.readPath,link);await assert.rejects(()=>readableSessionFile(link,scope),/符号链接/);
  fs.symlinkSync(path.dirname(a.originalPath),sessionFileDirectory('symlink',f.store));assert.throws(()=>storeSessionFile('symlink','a.txt',data('A'),f.store),e=>e.code==='REFERENCE_STORE_FAILED');
 }finally{f.close();}
});
