require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {workspaceReferenceTarget}=require('../src/infrastructure/workspaces/reference-path.server.ts');
test('attachment API paths resolve within selected project without registering model tools',async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'workspace-reference-')));
 try{
  const a=path.join(root,'a'),outside=path.join(root,'outside');fs.mkdirSync(a);fs.mkdirSync(outside);fs.writeFileSync(path.join(a,'file'),'A');fs.symlinkSync(outside,path.join(a,'escape'));
  const projects=[{id:'a',workspaceId:'w',rootPath:a,name:'a'}];
  assert.equal((await workspaceReferenceTarget(projects,'a','file')).target,path.join(a,'file'));
  for(const [id,relative] of [['a','../outside'],['a','escape'],['a',outside],['unknown','file']])await assert.rejects(workspaceReferenceTarget(projects,id,relative),e=>e.code==='PATH_OUTSIDE_WORKSPACE');
  fs.renameSync(a,a+'-original');fs.symlinkSync(outside,a);
  await assert.rejects(workspaceReferenceTarget(projects,'a',''),e=>e.code==='PATH_OUTSIDE_WORKSPACE');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
