#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const schemas=['core-schema.sql','role-schema.sql','workspace-schema.sql'];
function packageRelease(root,destination=path.join(root,'release'),{withoutNodeModules=false}={}){
 root=path.resolve(root);destination=path.resolve(destination);
 const build=path.resolve(root,process.env.AI_WORKSPACE_BUILD_DIR||'.next');
 const standalone=path.join(build,'standalone');
 const buildRelative=path.relative(root,build);
 if(!buildRelative||buildRelative.startsWith('..')||path.isAbsolute(buildRelative))throw Error('Release builds must use a build directory inside the application root.');
 if(fs.existsSync(destination))throw Error('Release destination already exists; choose a new directory. Existing data was not changed.');
 if(!fs.existsSync(path.join(standalone,'server.js'))||!fs.existsSync(path.join(build,'BUILD_ID'))||!fs.existsSync(path.join(build,'static')))throw Error('Standalone build is missing. Run npm run build first.');
 if(destination===root||root.startsWith(destination+path.sep)||destination===build||destination.startsWith(build+path.sep))throw Error('Release destination must be outside the build and must not contain the application root.');
 for(const name of schemas)fs.accessSync(path.join(root,'src/infrastructure/database',name));
 if(withoutNodeModules)for(const name of ['package.json','package-lock.json'])fs.accessSync(path.join(root,name));
 fs.mkdirSync(destination,{recursive:true});
 const excluded=new Set(['src','web','tests','scripts','.git','.data','models.json','settings.json','auth.json']);
 if(withoutNodeModules)excluded.add('node_modules');
 fs.cpSync(standalone,destination,{recursive:true,filter:source=>{
  const relative=path.relative(standalone,source),first=relative.split(path.sep)[0];
  return !excluded.has(first)&&!first.startsWith('.env');
 }});
 if(withoutNodeModules)for(const name of ['package.json','package-lock.json'])fs.copyFileSync(path.join(root,name),path.join(destination,name));
 fs.cpSync(path.join(build,'static'),path.join(destination,buildRelative,'static'),{recursive:true});
 if(fs.existsSync(path.join(root,'public')))fs.cpSync(path.join(root,'public'),path.join(destination,'public'),{recursive:true});
 fs.mkdirSync(path.join(destination,'runtime/database'),{recursive:true});
 for(const name of schemas)fs.copyFileSync(path.join(root,'src/infrastructure/database',name),path.join(destination,'runtime/database',name));
 fs.mkdirSync(path.join(destination,'scripts'),{recursive:true});
 for(const name of ['start-systemd.sh','systemd.cjs'])fs.copyFileSync(path.join(root,'scripts',name),path.join(destination,'scripts',name));
 fs.writeFileSync(path.join(destination,'release.json'),JSON.stringify({generatedAt:new Date().toISOString(),dependencies:withoutNodeModules?'install-on-server':'included',platform:process.platform,arch:process.arch,node:process.versions.node,nodeModulesABI:process.versions.modules,buildId:fs.readFileSync(path.join(build,'BUILD_ID'),'utf8').trim()},null,2)+'\n');
 fs.writeFileSync(path.join(destination,'RUN.txt'),(withoutNodeModules?'First install locked production dependencies: npm ci --omit=dev\n':'')+'Run from this directory with compatible Node.js >=22.19.0:\n  HOSTNAME=0.0.0.0 PORT=3000 node server.js\nSet INIT_CWD to this directory if inherited from another npm command.\nKeep the deployment path stable; .data and Pi session identities must be preserved.\nProvide models.json/settings.json and credentials separately; no user data is included.\nBuild and run on compatible OS, architecture, libc and Node ABI.\n');
 return destination;
}
if(require.main===module){try{
 const args=process.argv.slice(2),withoutNodeModules=args.includes('--without-node-modules');
 const destinations=args.filter(arg=>arg!=='--without-node-modules');
 if(destinations.length>1||destinations.some(arg=>arg.startsWith('--')))throw Error('Usage: node scripts/package-release.cjs [destination] [--without-node-modules]');
 console.log('Release ready: '+packageRelease(path.resolve(__dirname,'..'),destinations[0],{withoutNodeModules}));
}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={packageRelease};
