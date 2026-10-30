require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathsOverlap}=require('../src/application/bots/project-path-boundary.ts');
const {botFiles}=require('../src/infrastructure/bots/bot-files.server.ts');

test('path overlap detects equal, nested and parent roots without matching sibling prefixes',()=>{
  assert.equal(pathsOverlap('/workspace/project','/workspace/project'),true);
  assert.equal(pathsOverlap('/workspace','/workspace/project'),true);
  assert.equal(pathsOverlap('/workspace/project','/workspace'),true);
  assert.equal(pathsOverlap('/workspace/project','/workspace/project-copy'),false);
});

test('Bot file browser denies paths overlapping a bound Project root',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bot-project-boundary-')),
    file=path.join(root,'README.md');
  fs.writeFileSync(file,'project content');
  assert.throws(()=>botFiles.list(root,'',[root]),error=>error.code==='BOT_WORKSPACE_PROJECT_OVERLAP');
  assert.throws(()=>botFiles.read(root,'README.md',[root]),error=>error.code==='BOT_WORKSPACE_PROJECT_OVERLAP');
});

test('Bot file browser remains available when its workspace is separate from Project roots',()=>{
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'bot-workspace-boundary-')),
    project=fs.mkdtempSync(path.join(os.tmpdir(),'project-root-boundary-'));
  fs.writeFileSync(path.join(workspace,'notes.md'),'bot notes');
  const listing=botFiles.list(workspace,'',[project]),preview=botFiles.read(workspace,'notes.md',[project]);
  assert.equal(listing.entries[0].name,'notes.md');assert.equal(preview.content,'bot notes');
});
