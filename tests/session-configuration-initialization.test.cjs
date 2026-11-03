require('./register.cjs');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
let pi, createPersistentAgentSession;
before(async () => {
  pi = await import('@earendil-works/pi-coding-agent');
  const Module = require('node:module'), original = Module._load;
  Module._load = function(spec, ...args) { return spec === '@earendil-works/pi-coding-agent' ? pi : original.call(this, spec, ...args); };
  try { ({ createPersistentAgentSession } = require('../src/infrastructure/pi/create-session.server.ts')); }
  finally { Module._load = original; }
});
const model = { id:'test', name:'Test', provider:'test', api:'openai-completions', baseUrl:'https://example.invalid', reasoning:true, input:['text'], cost:{input:0,output:0,cacheRead:0,cacheWrite:0}, contextWindow:32000, maxTokens:1024 };
async function open(manager, directory, changes = {}) {
  const loader = new pi.DefaultResourceLoader({cwd:directory, agentDir:directory, noExtensions:true, noSkills:true, noContextFiles:true, noPromptTemplates:true, noThemes:true});
  await loader.reload();
  return createPersistentAgentSession({cwd:directory, agentDir:directory, sessionManager:manager, model, thinkingLevel:'off', modelRuntime:{getModel:()=>model, getPhysicalModel:()=>model}, settingsManager:pi.SettingsManager.inMemory({compaction:{enabled:false}}), resourceLoader:loader, noTools:'all', ...changes});
}
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'pi-config-'));
  const file = path.join(directory,'session.jsonl'); fs.writeFileSync(file,'');
  return { directory, file, manager:pi.SessionManager.open(file,directory,directory), close:()=>fs.rmSync(directory,{recursive:true,force:true}) };
}
test('metadata-only session can reopen repeatedly without new configuration entries or file writes', async () => {
  const f = fixture();
  try {
    const first = await open(f.manager,f.directory); first.session.dispose();
    assert.deepEqual(f.manager.getEntries().map(e=>e.type),['model_change','thinking_level_change']);
    const bytes = fs.readFileSync(f.file,'utf8'), leaf = f.manager.getLeafId();
    for(let i=0;i<3;i++) {
      const manager = pi.SessionManager.open(f.file,f.directory,f.directory);
      const result = await open(manager,f.directory); result.session.dispose();
      assert.equal(manager.getLeafId(),leaf); assert.equal(manager.getEntries().length,2);
      assert.equal(fs.readFileSync(f.file,'utf8'),bytes);
      assert.equal(Object.hasOwn(manager,'appendModelChange'),false);
      assert.equal(Object.hasOwn(manager,'appendThinkingLevelChange'),false);
    }
  } finally { f.close(); }
});
test('changed configuration is recorded once; comparison uses current branch rather than other branches', async () => {
  const f=fixture();
  try {
    (await open(f.manager,f.directory)).session.dispose();
    const originalLeaf=f.manager.getLeafId();
    const changed={...model,id:'changed'};
    (await open(f.manager,f.directory,{model:changed,thinkingLevel:'high'})).session.dispose();
    assert.equal(f.manager.getEntries().length,4);
    const changedLeaf=f.manager.getLeafId();
    (await open(f.manager,f.directory,{model:changed,thinkingLevel:'high'})).session.dispose();
    assert.equal(f.manager.getLeafId(),changedLeaf); assert.equal(f.manager.getEntries().length,4);
    f.manager.branch(originalLeaf);
    (await open(f.manager,f.directory)).session.dispose();
    assert.equal(f.manager.getLeafId(),originalLeaf); assert.equal(f.manager.getEntries().length,4);
    (await open(f.manager,f.directory,{model:changed,thinkingLevel:'high'})).session.dispose();
    assert.equal(f.manager.getEntries().length,6);
  } finally { f.close(); }
});
test('existing duplicate nodes and populated conversations are preserved on reopen', async () => {
  const f=fixture();
  try {
    for(let i=0;i<2;i++) { f.manager.appendModelChange(model.provider,model.id); f.manager.appendThinkingLevelChange('off'); }
    let bytes=fs.readFileSync(f.file,'utf8');
    (await open(f.manager,f.directory)).session.dispose();
    assert.equal(f.manager.getEntries().length,4); assert.equal(fs.readFileSync(f.file,'utf8'),bytes);
    f.manager.appendMessage({role:'user',content:'hello',timestamp:1});
    bytes=fs.readFileSync(f.file,'utf8'); const leaf=f.manager.getLeafId();
    (await open(f.manager,f.directory)).session.dispose();
    assert.equal(f.manager.getLeafId(),leaf); assert.equal(fs.readFileSync(f.file,'utf8'),bytes);
  } finally { f.close(); }
});
test('missing metadata is added and initialization failure restores native methods', async () => {
  const f=fixture();
  try {
    f.manager.appendModelChange(model.provider,model.id);
    (await open(f.manager,f.directory)).session.dispose();
    assert.equal(f.manager.getEntries().length,2);
    const appendModel=f.manager.appendModelChange, appendThinking=f.manager.appendThinkingLevelChange;
    await assert.rejects(open(f.manager,f.directory,{resourceLoader:{getExtensions(){throw Error('initialization failed');}}}),/initialization failed/);
    assert.equal(f.manager.appendModelChange,appendModel); assert.equal(f.manager.appendThinkingLevelChange,appendThinking);
    const length=f.manager.getEntries().length;
    f.manager.appendModelChange(model.provider,model.id);
    assert.equal(f.manager.getEntries().length,length+1);
  } finally { f.close(); }
});
