require('./register.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const Database=require('better-sqlite3');
const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),'bot-pi-history-'));
process.env.AI_WORKSPACE_DATA_ROOT=dataRoot;
const {inspectBackup,applyPurge}=require('../scripts/purge-bot-pi-sessions.cjs');

test('Bot Pi history cleanup archives only app-managed transcripts and preserves Bot workspace',async()=>{
  const botId='bot-test-id',backup=path.join(dataRoot,'pre-reset.sqlite'),db=new Database(backup);
  db.exec('CREATE TABLE bots(id TEXT PRIMARY KEY);');db.prepare('INSERT INTO bots VALUES(?)').run(botId);db.close();
  const botRoot=path.join(dataRoot,'bots',botId),piDir=path.join(botRoot,'pi-sessions'),workspace=path.join(botRoot,'workspace');
  fs.mkdirSync(path.join(piDir,'nested'),{recursive:true});fs.mkdirSync(workspace,{recursive:true});fs.writeFileSync(path.join(piDir,'nested','session.jsonl'),'native history');fs.writeFileSync(path.join(workspace,'keep.txt'),'user workspace');
  const plan=inspectBackup(backup);assert.equal(plan.totalFiles,1);assert.equal(plan.piSessionDirectories[0].botId,botId);
  const result=await applyPurge(backup,plan,{checkOffline:false});assert.equal(result.removedFiles,1);assert.equal(fs.existsSync(piDir),false);assert.equal(fs.readFileSync(path.join(workspace,'keep.txt'),'utf8'),'user workspace');
  assert.equal(fs.readFileSync(path.join(result.backupArchive,botId,'pi-sessions','nested','session.jsonl'),'utf8'),'native history');
});
