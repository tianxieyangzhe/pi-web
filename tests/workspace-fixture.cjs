require('./register.cjs');
const Database=require('better-sqlite3');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {targetSchema}=require('../src/infrastructure/database/schema.server.ts');
const {createWorkspaceRepository}=require('../src/infrastructure/database/workspace-repository.ts');
const {createWorkspaceService}=require('../src/application/workspace-service.ts');
const {workspaceDirectories}=require('../src/infrastructure/workspaces/directories.server.ts');
function fixture(){
 const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec(targetSchema);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-test-'));const a=path.join(root,'a'),b=path.join(root,'b');fs.mkdirSync(a);fs.mkdirSync(b);
 const repository=createWorkspaceRepository(db),handles=new Map(),persisted=new Map(),inputs=[],sent=[];let complete;
 const runtime={getHandle(id,input){return handles.get(id);},async initializeProject(input,commit){inputs.push(input);const ref=commit({kind:'pi',sessionId:input.session.id,cwd:input.workingDirectory,sessionFile:path.join(root,input.session.id+'.jsonl')});const h={id:input.session.id};handles.set(h.id,h);persisted.set(h.id,[]);return h;},async restore(input){inputs.push(input);const h={id:input.session.id};handles.set(h.id,h);return h;},async readRequestEntries(input){return persisted.get(input.session.id)??[];},requestEntries(h){return persisted.get(h.id)??[];},requestEntry(h,type,data){persisted.get(h.id).push({type,data});return 'entry';},subscribe(){return ()=>{};},async send(h,text,emit){sent.push({id:h.id,text});await new Promise(resolve=>{complete=resolve;});},async readTree(input){return {entries:[],activeLeafId:null};},async close(h){handles.delete(h.id);},async interrupt(){complete?.();},async inspect(){return {runtimeReady:true,sessionState:'idle',compactionState:'idle',canCompact:true};},async compact(){},cancelCompaction(){},async history(){return {entryIds:[],requests:[]};},async summarize(){throw new Error('no model');}};
 const service=createWorkspaceService({repository,directories:workspaceDirectories,runtime,readFile:(workspaceId,projectId,relative)=>require('../src/infrastructure/workspaces/file-preview.server.ts').readWorkspaceFile(repository.get(workspaceId).projects,projectId,relative)});
 return {db,root,a,b,repository,service,runtime,inputs,sent,persisted,handles,finish:()=>complete?.(),close(){db.close();fs.rmSync(root,{recursive:true,force:true});}};
}
module.exports={fixture};
