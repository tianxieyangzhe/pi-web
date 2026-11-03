require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {contentBlocks,treeRelations,temporaryMessage}=require('../web/workspace/conversation/session-tree-projection.ts');
test('all branches retain native order and shared ancestors; missing/self parents remain inspectable',()=>{
 const entries=[['root',null],['a','root'],['b','root'],['orphan','missing'],['self','self']].map(([id,parentId])=>({entry:{id,parentId,type:'message',timestamp:'now'},label:null,labelTimestamp:null}));
 const tree={entries,activeLeafId:'b'},relation=treeRelations(tree);
 assert.deepEqual([...relation.active],['b','root']);assert.equal(relation.children.get('root'),2);assert.equal(relation.entries.size,5);assert.deepEqual(tree.entries.map(x=>x.entry.id),['root','a','b','orphan','self']);
});
test('content projection retains thinking, raw tool arguments, unknown blocks and original strings',()=>{
 const content=[{type:'text',text:'**正文**'},{type:'thinking',thinking:'private reasoning'},{type:'toolCall',name:'bash',arguments:{token:'secret'}},{type:'future',sensitive:'original'}];
 assert.deepEqual(contentBlocks(content),content);assert.deepEqual(contentBlocks('hello'),[{type:'text',text:'hello'}]);assert.deepEqual(contentBlocks({unrecognized:true}),[{type:'unknown',value:{unrecognized:true}}]);
});
test('stream projection uses latest native message snapshot and preserves payload without text matching',()=>{
 const first={role:'assistant',content:[{type:'text',text:'你'}]},last={role:'assistant',content:[{type:'text',text:'你好'}]};
 const node={key:'run:tmp',entryId:null,events:[{payload:{message:first}},{payload:{message:last}},{payload:{unrelated:true}}]};
 assert.equal(temporaryMessage(node),last);assert.equal(node.entryId,null);assert.equal(node.events.length,3);
});
