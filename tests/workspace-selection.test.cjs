require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {isSelected,selectedProjectId}=require('../web/workspace/sidebar/workspace-selection.ts');
test('workspace selection never resolves to an independent project or highlights its session',()=>{
 const selected={kind:'workspace',workspaceId:'w',sessionId:'s'};
 assert.equal(selectedProjectId(selected),null);assert.equal(isSelected(selected,'project','w'),false);assert.equal(isSelected(selected,'project-session','s'),false);
 assert.equal(selectedProjectId({kind:'project',projectId:'p',sessionId:'s'}),'p');assert.equal(isSelected({kind:'project',projectId:'p',sessionId:'s'},'project-session','s'),true);
});
