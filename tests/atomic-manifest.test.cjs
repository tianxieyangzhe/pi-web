require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {atomicManifestFileSystem,AtomicManifestPlugin}=require('../src/infrastructure/build/atomic-manifest-plugin.cjs');
test('Next configuration imports directly in Node without TypeScript or SWC loaders',async()=>{const config=(await import('../next.config.mjs')).default;assert.equal(config.reactStrictMode,true);const options={plugins:[]};assert.equal(config.webpack(options,{dev:true,nextRuntime:'nodejs'}),options);assert(options.plugins[0] instanceof AtomicManifestPlugin);});
const write=(system,file,data)=>new Promise((resolve,reject)=>system.writeFile(file,data,error=>error?reject(error):resolve()));

test('manifest readers retain a complete old version until the new file commits',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'next-manifest-')),file=path.join(dir,'build-manifest.json');fs.writeFileSync(file,'{"version":"old"}');
 let finish;const delayed=Object.create(fs);delayed.writeFile=(file,data,callback)=>{fs.writeFileSync(file,'');finish=()=>fs.writeFile(file,data,callback);};
 const system=atomicManifestFileSystem(delayed,dir);const pending=write(system,file,'{"version":"new"}');
 for(let i=0;i<50;i++)assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{version:'old'});
 finish();await pending;assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{version:'new'});assert.deepEqual(fs.readdirSync(dir),['build-manifest.json']);
});

test('failed manifest commit preserves existing content and returns the original error',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'next-manifest-')),file=path.join(dir,'app-paths-manifest.json');fs.writeFileSync(file,'{"ready":true}');
 const broken=Object.create(fs),error=Object.assign(new Error('rename failed'),{code:'EACCES'});broken.rename=(_from,_to,callback)=>callback(error);
 await assert.rejects(write(atomicManifestFileSystem(broken,dir),file,'{"ready":false}'),cause=>cause===error);
 assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{ready:true});assert.deepEqual(fs.readdirSync(dir),['app-paths-manifest.json']);
});

test('ordinary assets and manifests outside the compiler output keep direct write behavior',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'next-manifest-')),calls=[];const system=Object.create(fs);system.writeFile=(file,data,callback)=>{calls.push(file);fs.writeFile(file,data,callback);};const wrapped=atomicManifestFileSystem(system,path.join(dir,'output'));
 const asset=path.join(dir,'app.js'),outside=path.join(dir,'build-manifest.json');await write(wrapped,asset,'code');await write(wrapped,outside,'{}');assert.deepEqual(calls,[asset,outside]);
});

test('actual Webpack compilation emits a valid manifest through the plugin',async()=>{
 const compiled=require('next/dist/compiled/webpack/webpack');const webpack=compiled.webpack;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'next-webpack-manifest-'));fs.writeFileSync(path.join(dir,'entry.js'),'module.exports = 1;');
 const emit={apply(compiler){compiler.hooks.thisCompilation.tap('TestManifest',compilation=>{compilation.hooks.processAssets.tap({name:'TestManifest',stage:webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS},()=>compilation.emitAsset('build-manifest.json',new webpack.sources.RawSource('{"complete":true}')));});}};
 const compiler=webpack({mode:'development',context:dir,entry:'./entry.js',output:{path:path.join(dir,'output'),filename:'app.js'},plugins:[new AtomicManifestPlugin(),emit]});
 await new Promise((resolve,reject)=>compiler.run((error,stats)=>compiler.close(closeError=>error||closeError||stats.hasErrors()?reject(error||closeError||new Error(stats.toString())):resolve())));
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'output/build-manifest.json'),'utf8')),{complete:true});assert.ok(fs.existsSync(path.join(dir,'output/app.js')));
});
