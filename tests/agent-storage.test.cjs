require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');

test('Agent Markdown is the canonical version content and SQLite stores only its index and digest',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-store-'));
  process.env.AI_WORKSPACE_DB_PATH=path.join(root,'workspace.sqlite');
  process.env.AI_WORKSPACE_AGENT_DIR=path.join(root,'agents');
  const {agentRepository}=require('../src/infrastructure/database/agent-repository.server.ts'),{database}=require('../src/infrastructure/database/database.server.ts'),{roleETag,snapshot}=require('../src/domain/agent-definition.ts');
  const definition={instructions:'# Data specialist\nCompare project contracts and cite evidence.',capabilities:{readFiles:true,writeFiles:false,readProjects:false,dispatchTasks:false,dispatchProjectWrites:false,exchangeMessages:false}};
  const created=agentRepository.create({name:'Data specialist',description:'Cross-project analysis',kind:'coordinator',botId:null,projectId:null,sourceTemplateId:null,definition,status:'active'});
  const v1=path.join(process.env.AI_WORKSPACE_AGENT_DIR,created.id,'1.md'),row=database.prepare('SELECT * FROM agents WHERE id=?').get(created.id);
  assert(fs.existsSync(v1));assert.match(fs.readFileSync(v1,'utf8'),/# Data specialist/);assert.equal(row.definition_json,null);assert.equal(row.content_sha256,created.contentSha256);assert(snapshot(created).contentSha256===created.contentSha256);
  const updated=agentRepository.update(created.id,{name:created.name,description:created.description,kind:created.kind,botId:null,projectId:null,sourceTemplateId:null,definition:{...definition,instructions:definition.instructions+'\nAdd a concise comparison table.'},status:'active'},roleETag(created));
  assert.equal(updated.revision,2);assert(fs.existsSync(v1));assert(fs.existsSync(path.join(process.env.AI_WORKSPACE_AGENT_DIR,created.id,'2.md')));assert.equal(database.prepare('SELECT definition_json FROM agents WHERE id=?').get(created.id).definition_json,null);
  assert.equal(agentRepository.delete(created.id),true);assert.equal(fs.existsSync(path.dirname(v1)),false);database.close();fs.rmSync(root,{recursive:true,force:true});
});
