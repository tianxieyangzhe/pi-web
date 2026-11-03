require('./register.cjs');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
let SessionManager, CURRENT_SESSION_VERSION, snapshotTree, readNativeFile, readTreeFile;
before(async () => {
  const pi = await import('@earendil-works/pi-coding-agent');
  ({ SessionManager, CURRENT_SESSION_VERSION } = pi);
  const Module = require('node:module'), old = Module._load;
  Module._load = function(spec, ...args) { return spec === '@earendil-works/pi-coding-agent' ? pi : old.call(this, spec, ...args); };
  try { ({ snapshotTree, readNativeFile, readTreeFile } = require('../src/infrastructure/pi/session-tree.server.ts')); } finally { Module._load = old; }
});

test('tree returns all branches and sensitive native content without changing history', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pi-tree-'));
  try {
    const file=path.join(dir,'s.jsonl'); fs.writeFileSync(file,'');
    const manager=SessionManager.open(file,dir,dir);
    const root=manager.appendMessage({role:'user',content:'hello',timestamp:1});
    manager.appendCustomMessageEntry('internal','secret-token',false,{thinking:'private'});
    manager.branch(root); manager.appendCustomEntry('tool',{arguments:{password:'secret'}});
    const before=fs.readFileSync(file,'utf8');
    const snap=readTreeFile(file,dir,manager.getSessionId());
    assert.equal(snap.entries.length,3); assert.equal(snap.entries[0].entry.id,root);
    assert.match(JSON.stringify(snap),/secret-token/); assert.match(JSON.stringify(snap),/password/);
    assert.equal(snap.entries[1].entry.parentId,root); assert.equal(snap.entries[2].entry.parentId,root);
    assert.equal(fs.readFileSync(file,'utf8'),before);
    manager.branch(root); assert.equal(snapshotTree(manager).activeLeafId,root);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('rejects old version and corrupted tree without rewriting file', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pi-tree-')); const file=path.join(dir,'s.jsonl');
 try {
  const header={type:'session',version:CURRENT_SESSION_VERSION-1,id:'a',cwd:dir,timestamp:new Date().toISOString()};
  fs.writeFileSync(file,JSON.stringify(header)+'\n');const before=fs.readFileSync(file,'utf8');
  assert.throws(()=>readNativeFile(file,dir,'a'),e=>e.code==='SESSION_TREE_READ_FAILED');assert.equal(fs.readFileSync(file,'utf8'),before);
  header.version=CURRENT_SESSION_VERSION;
  const a={type:'custom',id:'a',parentId:'b',timestamp:'t'},b={type:'custom',id:'b',parentId:'a',timestamp:'t'};
  fs.writeFileSync(file,[header,a,b].map(JSON.stringify).join('\n')+'\n');
  assert.throws(()=>readNativeFile(file,dir,'a'),e=>e.code==='SESSION_TREE_READ_FAILED');
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
