require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),Database=require('better-sqlite3');
const {targetSchema}=require('../src/infrastructure/database/schema.server.ts');
const {readSessionSnapshot,isRoleSnapshot}=require('../src/domain/agent-definition.ts');
const {hydrateAgentSnapshot}=require('../src/infrastructure/database/agent-snapshot.server.ts');

test('historical bindings expose only an inert identity and never evaluate retired execution configuration',()=>{
 const original={id:'old-agent',name:'Historical',revision:3};
 for(const key of ['policy','extension','definition'])Object.defineProperty(original,key,{get(){throw Error('retired configuration must not be accessed');}});
 const expected={agentId:'old-agent',name:'Historical',revision:3,legacy:true};
 assert.deepEqual(readSessionSnapshot(original),expected);
 assert.deepEqual(hydrateAgentSnapshot(original),expected);
 assert.equal(isRoleSnapshot(expected),false);
 assert.deepEqual(readSessionSnapshot({agentId:'old-agent',name:'Historical',revision:3,definition:{old:'configuration'}}),expected);
 assert.throws(()=>readSessionSnapshot({id:'broken',revision:0}),e=>e.code==='ROLE_BINDING_INVALID');
});

test('MCP reference lookup and deletion use current sessions without any retired tables',()=>{
 const db=new Database(':memory:');db.exec(targetSchema);
 const source=require.resolve('../src/infrastructure/database/database.server.ts'),repository=require.resolve('../src/infrastructure/database/mcp-repository.server.ts');
 const previous=require.cache[source],previousRepository=require.cache[repository];
 require.cache[source]={id:source,filename:source,loaded:true,exports:{database:db,assertSchemaCompatible(){}}};delete require.cache[repository];
 try{
  const {mcpRepository}=require(repository);
  const mcp=mcpRepository.create({name:'MCP',description:null,config:{kind:'stdio',command:'example',args:[],envSecretRefs:{}},accessPolicy:'read_only',status:'active'});
  assert.equal(mcpRepository.isInUse(mcp.id),false);
  db.prepare("INSERT INTO projects VALUES('p','P',NULL,'code','/tmp','active','now','now')").run();
  db.prepare("INSERT INTO sessions(id,project_id,purpose,mcp_ids_json,created_at,updated_at) VALUES('s','p','',?,'now','now')").run(JSON.stringify([mcp.id]));
  assert.equal(mcpRepository.isInUse(mcp.id),true);
  assert.equal(mcpRepository.isInUse('unreferenced'),false);
  db.prepare("DELETE FROM sessions WHERE id='s'").run();assert.equal(mcpRepository.isInUse(mcp.id),false);assert.equal(mcpRepository.delete(mcp.id),true);
 }finally{
  db.close();if(previous)require.cache[source]=previous;else delete require.cache[source];
  if(previousRepository)require.cache[repository]=previousRepository;else delete require.cache[repository];
 }
});
