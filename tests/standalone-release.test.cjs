const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {packageRelease}=require('../scripts/package-release.cjs');
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'standalone-package-'));const put=(name,value='fixture')=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};return {root,put,close:()=>fs.rmSync(root,{recursive:true,force:true})};}
test('release packages compiled assets and SQL without application source or private files',()=>{
 const f=fixture();try{
  for(const file of ['.next/standalone/server.js','.next/BUILD_ID','.next/static/chunks/app.js','public/icon.svg','.next/standalone/node_modules/runtime/index.js','scripts/start-systemd.sh','scripts/systemd.cjs'])f.put(file);
  for(const file of ['src/secret.ts','web/page.tsx','.env.local','.env.production','models.json','settings.json','auth.json','.data/database.sqlite'])f.put('.next/standalone/'+file,'private');
  const names=['core-schema.sql','bot-schema.sql','agent-binding-schema.sql','role-schema.sql','workspace-schema.sql'];for(const name of names)f.put('src/infrastructure/database/'+name,'SQL '+name);
  const destination=packageRelease(f.root);
  assert.equal(fs.readFileSync(path.join(destination,'runtime/database/core-schema.sql'),'utf8'),'SQL core-schema.sql');
  for(const file of ['server.js','.next/static/chunks/app.js','public/icon.svg','node_modules/runtime/index.js','scripts/start-systemd.sh','release.json'])assert.ok(fs.existsSync(path.join(destination,file)),file);
  for(const file of ['src','web','.env.local','.env.production','models.json','settings.json','auth.json','.data'])assert.equal(fs.existsSync(path.join(destination,file)),false,file);
  assert.throws(()=>packageRelease(f.root),/already exists/);
  assert.equal(fs.readFileSync(path.join(destination,'server.js'),'utf8'),'fixture');
 }finally{f.close();}
});
test('dependency download mode omits node_modules and preserves matching manifests and lockfile',()=>{
 const f=fixture();try{
  for(const file of ['.next/standalone/server.js','.next/BUILD_ID','.next/static/chunks/app.js','.next/standalone/node_modules/runtime/index.js','scripts/start-systemd.sh','scripts/systemd.cjs'])f.put(file);
  for(const name of ['core-schema.sql','bot-schema.sql','agent-binding-schema.sql','role-schema.sql','workspace-schema.sql'])f.put('src/infrastructure/database/'+name);
  f.put('package.json',JSON.stringify({name:'fixture',dependencies:{next:'1.0.0'}}));
  assert.throws(()=>packageRelease(f.root,undefined,{withoutNodeModules:true}),/ENOENT/);
  assert.equal(fs.existsSync(path.join(f.root,'release')),false);
  f.put('package-lock.json',JSON.stringify({lockfileVersion:3,packages:{}}));
  const destination=packageRelease(f.root,undefined,{withoutNodeModules:true});
  assert.equal(fs.existsSync(path.join(destination,'node_modules')),false);
  for(const name of ['package.json','package-lock.json'])assert.equal(fs.readFileSync(path.join(destination,name),'utf8'),fs.readFileSync(path.join(f.root,name),'utf8'));
  assert.match(fs.readFileSync(path.join(destination,'RUN.txt'),'utf8'),/npm ci --omit=dev/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(destination,'release.json'),'utf8')).dependencies,'install-on-server');
 }finally{f.close();}
});
test('missing standalone build refuses packaging without creating destination',()=>{
 const f=fixture();try{assert.throws(()=>packageRelease(f.root),/build is missing/);assert.equal(fs.existsSync(path.join(f.root,'release')),false);}finally{f.close();}
});
test('production build loads packaged SQL in memory without opening or creating user databases',()=>{
 const f=fixture();try{
  for(const name of ['core-schema.sql','bot-schema.sql','agent-binding-schema.sql','role-schema.sql','workspace-schema.sql'])f.put('runtime/database/'+name,fs.readFileSync(path.join(__dirname,'../src/infrastructure/database',name),'utf8'));
  const {execFileSync}=require('node:child_process');
  const script=`const assert=require('node:assert/strict');const {database,schemaCompatible}=require(${JSON.stringify(path.join(__dirname,'../src/infrastructure/database/database.server.ts'))});assert.equal(database.name,':memory:');assert.equal(schemaCompatible,true);assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name='projects'").get());database.close();`;
  const run=()=>execFileSync(process.execPath,['-r',path.join(__dirname,'register.cjs'),'-e',script],{cwd:f.root,env:{...process.env,NEXT_PHASE:'phase-production-build'},stdio:'pipe'});
  run();assert.equal(fs.existsSync(path.join(f.root,'.data')),false);
  f.put('.data/ai-workspace-v5.sqlite','existing database sentinel');
  run();assert.equal(fs.readFileSync(path.join(f.root,'.data/ai-workspace-v5.sqlite'),'utf8'),'existing database sentinel');
 }finally{f.close();}
});
test('systemd launcher starts an artifact server with release root and explicit host',()=>{
 const f=fixture();try{
  f.put('scripts/start-systemd.sh',fs.readFileSync(path.join(__dirname,'../scripts/start-systemd.sh'),'utf8'));
  f.put('server.js',"console.log(JSON.stringify({cwd:process.cwd(),init:process.env.INIT_CWD,host:process.env.HOSTNAME,port:process.env.PORT}));");
  const {execFileSync}=require('node:child_process');
  const result=JSON.parse(execFileSync('bash',[path.join(f.root,'scripts/start-systemd.sh')],{encoding:'utf8',env:{...process.env,NODE_BINARY:process.execPath,APP_HOST:'0.0.0.0',PORT:'3100'}}));
  assert.deepEqual(result,{cwd:fs.realpathSync(f.root),init:fs.realpathSync(f.root),host:'0.0.0.0',port:'3100'});
 }finally{f.close();}
});
