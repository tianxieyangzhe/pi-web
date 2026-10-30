require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {validateDefinition,emptyCapabilities}=require('../src/domain/agent-definition.ts');
const {createAgentPreparationService}=require('../src/application/agent-service.ts');

test('every uploaded Markdown format is sent to LLM and capabilities remain off',async()=>{
 let calls=0;const source='---\nmode: subagent\npermission:\n  edit: allow\n---\n# Project agent\nDo not invent missing facts.';
 const service=createAgentPreparationService({collect:async()=>{throw Error('not needed');},generate:async(input,_signal,mode)=>{calls++;assert.equal(mode,'import');const parsed=JSON.parse(input);assert.equal(parsed.sources[0].content,source);assert.equal(parsed.sources[0].path,'opencode-agent.md');return JSON.stringify({name:'项目协调员',description:'整理项目职责',instructions:'# 项目协调员\n保留未知项并提示核对。',warnings:['工具权限未映射']});}});
 const result=await service.prepare({kind:'project',mode:'import',markdown:source,fileName:'opencode-agent.md'},new AbortController().signal);
 assert.equal(calls,1);assert.equal(result.name,'项目协调员');assert.deepEqual(result.definition.capabilities,emptyCapabilities());assert.equal(result.sources[0].path,'opencode-agent.md');assert(result.warnings.includes('工具权限未映射'));
});

test('project generation creates a candidate from bounded sources without granting capabilities',async()=>{
 let calls=0;const service=createAgentPreparationService({collect:async()=>({sources:[{path:'README.md',hash:'hash',content:'项目说明'}],warnings:['局部材料']}),generate:async(input,_signal,mode)=>{calls++;assert.equal(mode,'generate');assert(input.includes('README.md'));return JSON.stringify({name:'项目角色',description:'项目协作',instructions:'# 指导\n只依据项目说明',warnings:['架构待确认']});}});
 const candidate=await service.prepare({kind:'project',projectId:'p',requirements:'维护配置下发'},new AbortController().signal);assert.equal(calls,1);assert.deepEqual(candidate.definition.capabilities,emptyCapabilities());assert.equal(candidate.sources[0].path,'README.md');assert(candidate.warnings.includes('架构待确认'));
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(service.prepare({kind:'project',projectId:'p'},cancelled.signal));assert.equal(calls,1);
});

test('dialogue revision uses prior draft and user feedback while retaining source files',async()=>{
 let calls=0;const service=createAgentPreparationService({collect:async()=>({sources:[],warnings:[]}),generate:async(input,_signal,mode)=>{calls++;assert.equal(mode,'revise');assert(input.includes('保留原权限边界'));assert(input.includes('补充跨项目对比'));assert(input.includes('architecture.md'));return JSON.stringify({name:'协调员',description:null,instructions:'# 协调员\n先检索，再跨项目比较。保留原权限边界。',warnings:[]});}});
 const result=await service.prepare({kind:'coordinator',mode:'revise',currentDraft:{name:'协调员',description:null,instructions:'# 协调员\n保留原权限边界'},feedback:'补充跨项目对比',referenceFiles:[{name:'architecture.md',content:'# Architecture'}]},new AbortController().signal);
 assert.equal(calls,1);assert.match(result.definition.instructions,/跨项目比较/);assert.match(result.definition.instructions,/保留原权限边界/);assert.deepEqual(result.definition.capabilities,emptyCapabilities());
});

test('oversized sources fail before model invocation and malformed output is rejected',async()=>{
 let called=false;const service=createAgentPreparationService({collect:async()=>({sources:[{path:'large',hash:'hash',content:'中'.repeat(5000)}],warnings:[]}),generate:async()=>{called=true;return '{}';}});
 await assert.rejects(service.prepare({kind:'coordinator',projectId:'p',requirements:'review'},new AbortController().signal),e=>e.code==='ROLE_INPUT_TOO_LARGE');assert.equal(called,false);
 const malformed=createAgentPreparationService({collect:async()=>({sources:[],warnings:[]}),generate:async()=>'{"unexpected":true}'});await assert.rejects(malformed.prepare({kind:'project',requirements:'make a helper'},new AbortController().signal),e=>e.code==='ROLE_GENERATION_INVALID');
});

test('role capability shape is strict and project roles cannot gain coordination capabilities',()=>{
 assert.throws(()=>validateDefinition({instructions:'role',capabilities:{...emptyCapabilities(),extra:true}},'project'));
 assert.throws(()=>validateDefinition({instructions:'role',capabilities:{...emptyCapabilities(),readProjects:true}},'project'));
 assert.throws(()=>validateDefinition({instructions:'role',capabilities:{...emptyCapabilities(),dispatchProjectWrites:true}},'coordinator'));
});
