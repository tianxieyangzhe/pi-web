require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Database=require('better-sqlite3');
const {targetSchema}=require('../src/infrastructure/database/schema.server.ts');
const {createAgentRepository}=require('../src/infrastructure/database/agent-repository.ts');
const {roleETag,snapshot}=require('../src/domain/agent-definition.ts');
const {writeAgentVersion,readAgentVersion}=require('../src/infrastructure/agents/agent-file-store.server.ts');
test('Agent immutable Markdown and conditional SQL index preserve previous versions, status-only revision and conflicted candidates',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-store-')),previous=process.env.AI_WORKSPACE_AGENT_DIR;process.env.AI_WORKSPACE_AGENT_DIR=path.join(root,'agents');const db=new Database(':memory:');db.exec(targetSchema);const repository=createAgentRepository(db);
 try{
  const definition={instructions:'# Data specialist\nCompare project contracts and cite evidence.',capabilities:{readFiles:true,writeFiles:false,readProjects:false,dispatchTasks:false,dispatchProjectWrites:false,exchangeMessages:false}};
  const created=repository.create({name:'Data specialist',description:'Cross-project analysis',kind:'coordinator',botId:null,projectId:null,sourceTemplateId:null,definition,status:'active'});
  const v1=path.join(process.env.AI_WORKSPACE_AGENT_DIR,created.id,'1.md'),before=fs.readFileSync(v1),row=db.prepare('SELECT * FROM agents WHERE id=?').get(created.id);
  assert(created.markdown.includes('# Data specialist'));assert.equal(row.definition_json,null);assert.equal(row.content_sha256,created.contentSha256);assert.equal(snapshot(created).contentSha256,created.contentSha256);
  const updated=repository.update(created.id,{definition:{...definition,instructions:definition.instructions+'\nAdd a comparison table.'}},roleETag(created));assert.equal(updated.revision,2);assert.deepEqual(fs.readFileSync(v1),before);assert.equal(repository.getVersion(created.id,1,created.contentSha256).definition.instructions,definition.instructions);
  assert.throws(()=>repository.update(created.id,{name:'stale'},roleETag(created)),e=>e.code==='WRITE_CONFLICT');const disabled=repository.update(created.id,{status:'disabled'},roleETag(updated));assert.equal(disabled.revision,2);assert.equal(disabled.contentSha256,updated.contentSha256);assert(!fs.existsSync(path.join(path.dirname(v1),'3.md')));
  assert.throws(()=>writeAgentVersion({agentId:created.id,revision:1,kind:'coordinator',name:'other',description:null,definition}),e=>e.code==='WRITE_CONFLICT');assert.deepEqual(fs.readFileSync(v1),before);
  assert.throws(()=>readAgentVersion(created.id,1,'b'.repeat(64)),e=>e.code==='ROLE_VERSION_MISSING');assert.equal(repository.delete(created.id),true);assert(fs.existsSync(v1),'unindexed immutable files remain available for review');
 }finally{db.close();if(previous===undefined)delete process.env.AI_WORKSPACE_AGENT_DIR;else process.env.AI_WORKSPACE_AGENT_DIR=previous;fs.rmSync(root,{recursive:true,force:true});}
});
