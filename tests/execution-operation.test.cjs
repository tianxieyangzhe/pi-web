require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {operationForRole,requestScopeInstructions}=require('../src/domain/execution-operation.ts');
function role(kind,capabilities){return {kind,definition:{capabilities:{readFiles:true,writeFiles:false,dispatchTasks:false,dispatchProjectWrites:false,exchangeMessages:false,...capabilities}}};}
test('normal messages use bound role capabilities without per-message write controls',()=>{
 assert.equal(operationForRole(role('project',{})),'read');
 assert.equal(operationForRole(role('project',{writeFiles:true})),'project_write');
 assert.equal(operationForRole(role('coordinator',{dispatchTasks:true,dispatchProjectWrites:true})),'project_write');
 assert.equal(operationForRole(role('coordinator',{dispatchTasks:true})),'read');
 assert(requestScopeInstructions.includes('讨论、询问、检查和读取不得擅自修改'));
});
