const fs=require('node:fs');const path=require('node:path');const Module=require('node:module');const swc=require('next/dist/build/swc');
const original=Module._resolveFilename;
Module._resolveFilename=function(spec,parent,...rest){if(spec.startsWith('@/'))spec=path.resolve(__dirname,'../src',spec.slice(2));if(spec==='server-only')return path.resolve(__dirname,'server-only.cjs');return original.call(this,spec,parent,...rest);};
require.extensions['.ts']=function(module,file){const source=fs.readFileSync(file,'utf8');const result=swc.transformSync(source,{filename:file,jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'commonjs'}});module._compile(result.code,file);};
