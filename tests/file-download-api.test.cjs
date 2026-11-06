require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
const {zipSync,strToU8}=require('fflate');
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'file-download-api-'))),outside=fs.mkdtempSync(path.join(os.tmpdir(),'file-download-outside-'));
const original=Module._load;
Module._load=function(spec,...args){if(spec==='@/infrastructure/database/project-repository.server')return {projectRepository:{get:id=>id==='p'?{id:'p',rootPath:root}:null}};return original.call(this,spec,...args);};
let previewRoute,downloadRoute,readWorkspaceFile,downloadWorkspaceFile;
try {
 previewRoute=require('../src/app/api/projects/[projectId]/files/content/route.ts');
 downloadRoute=require('../src/app/api/projects/[projectId]/files/download/route.ts');
 ({readWorkspaceFile,downloadWorkspaceFile}=require('../src/infrastructure/workspaces/file-preview.server.ts'));
}finally{Module._load=original;}
const {createWorkspaceService}=require('../src/application/workspace-service.ts');
const {createWorkspaceApi}=require('../src/shared/protocol/workspace-api.server.ts');
const project={id:'wp',rootPath:root},workspace={id:'w',projects:[project]};
const service=createWorkspaceService({repository:{get:id=>id==='w'?workspace:null},runtime:{},directories:{},readFile:(_,id,p)=>readWorkspaceFile(workspace.projects,id,p),downloadFile:(_,id,p)=>downloadWorkspaceFile(workspace.projects,id,p)});
const workspaceApi=createWorkspaceApi(service);
const name='0024oceanbase数据库适配.docx';
const tables=Array.from({length:7},(_,i)=>`<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格${i+1}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>&lt;script&gt;alert(1)&lt;/script&gt;</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`).join('');
const bytes=Buffer.from(zipSync({'word/document.xml':strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>OceanBase适配</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>数据库连接</w:t></w:r></w:p>${tables}<w:p><w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr><w:r><w:t>SELECT 1;</w:t><w:br/><w:t>SELECT 2;</w:t></w:r></w:p></w:body></w:document>`)}));
fs.writeFileSync(path.join(root,name),bytes);fs.writeFileSync(path.join(root,'a.txt'),'hello\n原文');fs.writeFileSync(path.join(root,'binary.bin'),Buffer.from([0,255]));fs.writeFileSync(path.join(root,'bad.docx'),'not a zip');fs.writeFileSync(path.join(root,'.env'),'secret');fs.writeFileSync(path.join(outside,'outside'),'outside');fs.symlinkSync(path.join(outside,'outside'),path.join(root,'escape'));fs.mkdirSync(path.join(root,'directory'));
function projectCall(action,relative,id='p'){return (action==='content'?previewRoute:downloadRoute).GET(new Request('http://localhost/api/projects/'+id+'/files/'+action+(relative===null?'':'?path='+encodeURIComponent(relative))),{params:Promise.resolve({projectId:id})});}
function workspaceCall(action,relative,owner='w',id='wp'){return workspaceApi(new Request('http://localhost/api/workspaces/'+owner+'/projects/'+id+'/files/'+action+'?path='+encodeURIComponent(relative)),[owner,'projects',id,'files',action]);}
test('Project and Workspace downloads return original Word bytes, UTF-8 filename, MIME, length and non-cache headers',async()=>{
 for(const response of [await projectCall('download',name),await workspaceCall('download',name)]){
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/wordprocessingml.document/);assert.match(response.headers.get('content-disposition'),/attachment;/);assert.ok(response.headers.get('content-disposition').includes(encodeURIComponent(name)));assert.equal(response.headers.get('content-length'),String(bytes.length));assert.equal(response.headers.get('cache-control'),'no-store, no-transform');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 }
 assert.deepEqual(fs.readFileSync(path.join(root,name)),bytes);
});
test('both content APIs expose ordered Word headings, seven tables and code without interpreting embedded HTML',async()=>{
 for(const response of [await projectCall('content',name),await workspaceCall('content',name)]){
  assert.equal(response.status,200);const data=(await response.json()).data;assert.equal(data.format,'docx');assert.equal(data.path,name);assert.equal(data.size,bytes.length);assert.deepEqual(data.blocks.slice(0,2).map(b=>[b.type,b.level]),[['heading',1],['heading',2]]);assert.equal(data.blocks.filter(b=>b.type==='table').length,7);assert.equal(data.blocks[2].rows[0][1],'<script>alert(1)</script>');assert.deepEqual(data.blocks.at(-1),{type:'code',text:'SELECT 1;\nSELECT 2;'});assert.match(data.notice,/分页/);
 }
 assert.deepEqual(fs.readFileSync(path.join(root,name)),bytes);
});
test('file APIs retain text, allow binary or invalid Word download with an honest preview notice',async()=>{
 for(const call of [projectCall,workspaceCall]){
  assert.deepEqual((await (await call('content','a.txt')).json()).data,{path:'a.txt',content:'hello\n原文',size:Buffer.byteLength('hello\n原文')});
  for(const relative of ['binary.bin','bad.docx']){const preview=(await (await call('content',relative)).json()).data;assert.equal(preview.format,'binary');assert.match(preview.notice,/下载原件/);assert.deepEqual(Buffer.from(await (await call('download',relative)).arrayBuffer()),fs.readFileSync(path.join(root,relative)));}
 }
});
test('both APIs reject missing, sensitive, traversing and escaping paths, directories and cross-owner access',async()=>{
 for(const action of ['content','download'])for(const call of [projectCall,workspaceCall]){
  for(const [relative,status]of [['missing',404],['.env',403],['../outside',403],['escape',403],['directory',400],[path.join(root,name),403]]){const response=await call(action,relative);assert.equal(response.status,status,action+':'+relative);assert.ok((await response.json()).error.code);assert.equal(response.headers.get('content-disposition'),null);}
 }
 assert.equal((await projectCall('download',null)).status,400);assert.equal((await projectCall('download',name,'other')).status,404);assert.equal((await workspaceCall('download',name,'other')).status,404);assert.equal((await workspaceCall('download',name,'w','other')).status,404);
});
test('preview limits do not block allowed downloads; files over 50MB fail before download headers',async()=>{
 const large=path.join(root,'large.txt');fs.writeFileSync(large,'x'.repeat(512*1024+1));
 for(const call of [projectCall,workspaceCall]){assert.equal((await (await call('content','large.txt')).json()).data.format,'binary');assert.equal((await call('download','large.txt')).status,200);}
 const fd=fs.openSync(path.join(root,'too-large'),'w');fs.ftruncateSync(fd,50_000_001);fs.closeSync(fd);
 for(const call of [projectCall,workspaceCall])for(const action of ['content','download']){const response=await call(action,'too-large');assert.equal(response.status,413);assert.equal(response.headers.get('content-disposition'),null);}
});
test('Excel APIs preserve workbook order, shared/inline strings, sparse columns and cached or uncached formulas',async()=>{
 const name='数据.xlsx';
 const packed=Buffer.from(zipSync({
  'xl/workbook.xml':strToU8('<workbook xmlns:r="rel"><sheets><sheet name="销售 &amp; 收入" r:id="second"/><sheet name="预算" r:id="first"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels':strToU8('<Relationships><Relationship Id="first" Target="worksheets/sheet1.xml"/><Relationship Id="second" Target="worksheets/sheet9.xml"/><Relationship Id="styles" Target="styles.xml"/><Relationship Id="remote" TargetMode="External" Target="https://example.invalid/data"/></Relationships>'),
  'xl/sharedStrings.xml':strToU8('<sst><si><r><t>销售</t></r><r><t>金额</t></r></si></sst>'),
  'xl/worksheets/sheet9.xml':strToU8('<worksheet><sheetData><row r="5"><c r="A5" t="s"><v>0</v></c><c r="C5"><f>SUM(A1:A4)</f><v>42</v></c><c r="D5"><f>NOW()</f></c><c r="E5" t="inlineStr"><is><t>&lt;script&gt;</t></is></c><c r="F5" t="b"><v>1</v></c></row></sheetData></worksheet>'),
  'xl/worksheets/sheet1.xml':strToU8('<worksheet><sheetData><row r="1"><c r="B1"><v>100.5</v></c></row></sheetData></worksheet>'),
 }));fs.writeFileSync(path.join(root,name),packed);
 for(const call of [projectCall,workspaceCall]){
  const response=await call('content',name);assert.equal(response.status,200);const p=(await response.json()).data;
  assert.equal(p.format,'xlsx');assert.deepEqual(p.blocks.filter(b=>b.type==='heading').map(b=>b.text),['销售 & 收入','预算']);
  assert.deepEqual(p.blocks[1].rows,[['行 / 列','A','B','C','D','E','F'],['5','销售金额','','42','=NOW()','<script>','TRUE']]);
  assert.deepEqual(p.blocks[3].rows,[['行 / 列','A','B'],['1','','100.5']]);assert.match(p.notice,/不重算/);
  assert.deepEqual(Buffer.from(await (await call('download',name)).arrayBuffer()),packed);
 }
});
test('PPT APIs preserve presentation relationship order and slide text/table contents',async()=>{
 const name='演示.pptx';
 const packed=Buffer.from(zipSync({
  'ppt/presentation.xml':strToU8('<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="b"/><p:sldId r:id="a"/></p:sldIdLst></p:presentation>'),
  'ppt/_rels/presentation.xml.rels':strToU8('<Relationships><Relationship Id="a" Target="slides/slide1.xml"/><Relationship Id="b" Target="slides/slide8.xml"/><Relationship Id="theme" Target="theme/theme1.xml"/></Relationships>'),
  'ppt/slides/slide8.xml':strToU8('<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><a:txBody><a:p><a:r><a:t>第一页</a:t></a:r><a:br/><a:r><a:t>内容</a:t></a:r></a:p></a:txBody></p:sp><a:tbl><a:tr><a:tc><a:p><a:r><a:t>项目</a:t></a:r></a:p></a:tc><a:tc><a:p><a:r><a:t>42</a:t></a:r></a:p></a:tc></a:tr></a:tbl></p:spTree></p:cSld></p:sld>'),
  'ppt/slides/slide1.xml':strToU8('<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>第二页</a:t></a:r></a:p></p:sld>'),
 }));fs.writeFileSync(path.join(root,name),packed);
 for(const call of [projectCall,workspaceCall]){
  const response=await call('content',name);assert.equal(response.status,200);const p=(await response.json()).data;assert.equal(p.format,'pptx');
  assert.deepEqual(p.blocks,[{type:'heading',level:2,text:'幻灯片 1'},{type:'paragraph',text:'第一页\n内容'},{type:'table',rows:[['项目','42']]},{type:'heading',level:2,text:'幻灯片 2'},{type:'paragraph',text:'第二页'}]);
  assert.deepEqual(Buffer.from(await (await call('download',name)).arrayBuffer()),packed);
 }
});
test('PDF APIs expose native preview metadata and return PDF MIME and exact original bytes',async()=>{
 const parts=['%PDF-1.4\n'],offsets=[0];
 for(const [i,body]of ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>','<< /Length 0 >>\nstream\n\nendstream'].entries()){offsets.push(Buffer.byteLength(parts.join('')));parts.push(`${i+1} 0 obj\n${body}\nendobj\n`);}
 const xref=Buffer.byteLength(parts.join(''));parts.push('xref\n0 5\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
 const bytes=Buffer.from(parts.join(''));fs.writeFileSync(path.join(root,'文档.pdf'),bytes);fs.writeFileSync(path.join(root,'bad.pdf'),'not pdf');
 for(const call of [projectCall,workspaceCall]){
  const p=(await (await call('content','文档.pdf')).json()).data;assert.equal(p.format,'pdf');assert.equal(p.size,bytes.length);assert.equal(p.content,'');
  const download=await call('download','文档.pdf');assert.equal(download.headers.get('content-type'),'application/pdf');assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
  assert.equal((await (await call('content','bad.pdf')).json()).data.format,'binary');
 }
});
test('Office API preview failures and projection limits retain a downloadable original',async()=>{
 const fixtures={
  'bad.xlsx':Buffer.from('broken'),
  'legacy.xls':Buffer.from([0xd0,0xcf,0x11,0xe0]),
  'legacy.ppt':Buffer.from([0xd0,0xcf,0x11,0xe0]),
  'entity.pptx':Buffer.from(zipSync({'ppt/presentation.xml':strToU8('<!DOCTYPE x [<!ENTITY a "bad">]><presentation/>'),'ppt/_rels/presentation.xml.rels':strToU8('<Relationships/>')})),
  'oversize.xlsx':Buffer.from(zipSync({'xl/workbook.xml':strToU8('<workbook xmlns:r="r"><sheet r:id="s"/></workbook>'),'xl/_rels/workbook.xml.rels':strToU8('<Relationships><Relationship Id="s" Target="worksheets/sheet.xml"/></Relationships>'),'xl/worksheets/sheet.xml':strToU8('<worksheet><row r="1"><c r="ZZZ1"><v>1</v></c></row></worksheet>')})),
 };
 for(const [name,bytes]of Object.entries(fixtures)){fs.writeFileSync(path.join(root,name),bytes);for(const call of [projectCall,workspaceCall]){const p=(await (await call('content',name)).json()).data;assert.equal(p.format,'binary',name);assert.match(p.notice,/下载/);assert.deepEqual(Buffer.from(await (await call('download',name)).arrayBuffer()),bytes);}}
});
test.after(()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});});
