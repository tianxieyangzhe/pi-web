require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {referenceTreeProjection}=require('../web/workspace/conversation/reference-tree-projection.ts');
function item(id,parentId,type,extra={}){return {entry:{id,parentId,type,timestamp:'now',...extra},label:null,labelTimestamp:null};}
const reference=(id,parentId)=>item(id,parentId,'custom_message',{customType:'user_reference_files',display:false,details:{referenceTurnId:id},content:[{type:'image',data:'secret-original',mimeType:'image/png'}]});
const user=(id,parentId)=>item(id,parentId,'message',{message:{role:'user',content:'question'}});
test('reference is projected after its direct user child without changing native order or losing content',()=>{
 const ref=reference('ref',null),prompt=user('user','ref'),reply=item('reply','user','message',{message:{role:'assistant',content:'answer'}}),tree={entries:[ref,prompt,reply],activeLeafId:'reply'};
 const before=JSON.stringify(tree),projection=referenceTreeProjection(tree);
 assert.deepEqual(projection.items.map(i=>i.entry.id),['user','reply']);assert.equal(projection.attachments.get('user')[0],ref);
 assert.equal(projection.attachments.get('user')[0].entry.content[0].data,'secret-original');assert.equal(JSON.stringify(tree),before);
 const ids=[...projection.items,...[...projection.attachments.values()].flat()].map(i=>i.entry.id);assert.equal(ids.length,3);assert.equal(new Set(ids).size,3);
});
test('orphan reference, intervening node, unknown custom and ambiguous branches remain standalone',()=>{
 const ref=reference('ref',null),tree={entries:[ref,user('a','ref'),user('b','ref'),reference('orphan',null),item('custom',null,'custom_message',{customType:'other',content:'secret'}),reference('intervening',null),item('internal','intervening','custom'),user('later','internal')],activeLeafId:'later'};
 const projection=referenceTreeProjection(tree);assert.deepEqual(projection.items,tree.entries);assert.equal(projection.attachments.size,0);
});
test('separate rounds and branches group only their own directly attached material',()=>{
 const entries=[reference('r1',null),user('u1','r1'),reference('r2','u1'),user('u2','r2'),reference('branch','u1'),user('u3','branch')];
 const result=referenceTreeProjection({entries,activeLeafId:'u2'});
 assert.deepEqual(result.items.map(i=>i.entry.id),['u1','u2','u3']);
 assert.deepEqual([...result.attachments].map(([id,refs])=>[id,refs.map(i=>i.entry.id)]),[['u1',['r1']],['u2',['r2']],['u3',['branch']]]);
});
