require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Database=require('better-sqlite3');
const {targetSchema}=require('../src/infrastructure/database/schema.server.ts');
const {matchesTargetSchema}=require('../src/infrastructure/database/schema-compatibility.ts');
const {jsonBody}=require('../src/shared/protocol/api.ts');
test('retired memory endpoints have no Next route handlers',()=>{
 const root=path.resolve(__dirname,'../src/app/api');
 for(const endpoint of ['projects/[projectId]/sessions/[sessionId]/memory','projects/[projectId]/sessions/[sessionId]/memory/context','projects/[projectId]/sessions/[sessionId]/memory/summarize','session-memory-templates','session-memory-templates/[templateId]']) {
  assert.equal(fs.existsSync(path.join(root,endpoint,'route.ts')),false,endpoint);
 }
});
test('Schema preflight reads only; retired memory or missing uniqueness/trigger keeps old data incompatible and untouched',()=>{
 const db=new Database(':memory:');try{
  db.exec(targetSchema);assert.equal(matchesTargetSchema(db,targetSchema),true);db.exec("CREATE TABLE session_memories(id TEXT PRIMARY KEY,context_json TEXT,draft_json TEXT);INSERT INTO session_memories VALUES('m','keep context','keep old draft')");const before=db.serialize();assert.equal(matchesTargetSchema(db,targetSchema),false);assert.deepEqual(db.serialize(),before);assert.equal(db.prepare('SELECT draft_json FROM session_memories').get().draft_json,'keep old draft');
  db.exec('DROP TABLE session_memories;DROP INDEX sessions_native_file_unique');assert.equal(matchesTargetSchema(db,targetSchema),false);
 }finally{db.close();}
});
test('HTTP JSON protocol handles empty action bytes, invalid UTF-8, unknown size and structural invalid input',async()=>{
 assert.deepEqual(await jsonBody(new Request('http://localhost',{method:'POST'}),65536,true),{});
 await assert.rejects(jsonBody(new Request('http://localhost',{method:'POST',body:' '})),e=>e.code==='INVALID_JSON');await assert.rejects(jsonBody(new Request('http://localhost',{method:'POST',body:'null'})),e=>e.code==='INVALID_JSON');await assert.rejects(jsonBody(new Request('http://localhost',{method:'POST',body:'[]'})),e=>e.code==='INVALID_JSON');await assert.rejects(jsonBody(new Request('http://localhost',{method:'POST',body:Buffer.from([0xff])})),e=>e.code==='INVALID_JSON');await assert.rejects(jsonBody(new Request('http://localhost',{method:'POST',body:JSON.stringify({x:'x'.repeat(70)})}),32),e=>e.code==='REQUEST_TOO_LARGE');
});
