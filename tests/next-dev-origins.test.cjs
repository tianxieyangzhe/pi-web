const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
let version=0;
async function load(value){
 const name='AI_WORKSPACE_ALLOWED_DEV_ORIGINS',previous=process.env[name];
 try{
  if(value===undefined)delete process.env[name];else process.env[name]=value;
  const url=pathToFileURL(path.resolve(__dirname,'../next.config.mjs'));
  url.searchParams.set('test',String(++version));
  return (await import(url.href)).default;
 }finally{if(previous===undefined)delete process.env[name];else process.env[name]=previous;}
}
test('unconfigured and empty development origins retain Next defaults',async()=>{
 for(const value of [undefined,'',' , , '])assert.deepEqual((await load(value)).allowedDevOrigins,[]);
});
test('deployment origins come from environment without embedded deployment IPs',async()=>{
 assert.deepEqual((await load(' 192.0.2.10, dev.example.com, , *.example.org ')).allowedDevOrigins,['192.0.2.10','dev.example.com','*.example.org']);
 assert.deepEqual((await load('198.51.100.20')).allowedDevOrigins,['198.51.100.20']);
});
