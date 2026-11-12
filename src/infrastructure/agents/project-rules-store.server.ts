import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,openSync,closeSync,fsyncSync,renameSync,rmSync} from 'node:fs';
import path from 'node:path';
import {DomainError} from '@/domain/errors';
import type {ProjectRuleIdentity,ProjectRulesStore} from '@/application/ports/project-rules';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function createProjectRulesStore(root=path.join(process.env.AI_WORKSPACE_AGENT_DIR??path.join(process.cwd(),'agents'),'project-rules')):ProjectRulesStore{
 const key=(id:ProjectRuleIdentity)=>JSON.stringify(id.scope==='project'?['project',id.projectId]:['workspace',id.workspaceId,id.projectId]);
 const directory=(id:ProjectRuleIdentity)=>path.join(root,hash(key(id)));
 const readFile=(file:string)=>{const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1048576)throw Error('invalid file');return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(readFileSync(file));};
 const assertDirs=(dir:string)=>{for(let current=dir;current!==path.dirname(current);current=path.dirname(current)){if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw Error('symlink');if(current===path.resolve(root))break;}};
 const store:ProjectRulesStore={read(identity){try{
   const dir=directory(identity);assertDirs(dir);let state={format:1,identity,revision:0,contentSha256:null as string|null,enabled:false};
   if(existsSync(path.join(dir,'state.json'))){const parsed=JSON.parse(readFile(path.join(dir,'state.json')));if(parsed.format!==1||key(parsed.identity)!==key(identity)||!Number.isInteger(parsed.revision)||parsed.revision<1||typeof parsed.enabled!=='boolean'||!/^[a-f0-9]{64}$/.test(parsed.contentSha256))throw Error('invalid state');state=parsed;}
   let markdown='';if(state.revision){const folder=path.join(dir,String(state.revision));assertDirs(folder);markdown=readFile(path.join(folder,'AGENTS.md'));if(!markdown.trim()||hash(markdown)!==state.contentSha256)throw Error('invalid body');}
   return {identity,revision:state.revision,contentSha256:state.contentSha256,enabled:state.enabled,markdown,writeETag:'"'+hash(JSON.stringify(state))+'"'};
 }catch{throw new DomainError('PROJECT_RULES_UNAVAILABLE','项目规则文件不可读或已损坏',409,true);}},
 write(identity,etag,change){
   if(!etag)throw new DomainError('PRECONDITION_REQUIRED','缺少If-Match',428,true);
   const current=store.read(identity);if(etag!==current.writeETag)throw new DomainError('WRITE_CONFLICT','项目规则已变化，请刷新',409,true);
   if('enabled' in change&&change.enabled&&!current.revision)throw new DomainError('INVALID_INPUT','请先生成AGENTS.md',400,true);
   if('enabled' in change&&change.enabled===current.enabled)return current;
   if('markdown' in change&&(!change.markdown.trim()||change.markdown.includes('\0')||Buffer.byteLength(change.markdown)>262144))throw new DomainError('INVALID_INPUT','项目规则必须为非空文本且不超过256KiB',400,true);
   const dir=directory(identity);let temp='';
   try{assertDirs(dir);mkdirSync(dir,{recursive:true,mode:0o700});
    let revision='markdown' in change?current.revision+1:current.revision;
    if('markdown' in change)while(existsSync(path.join(dir,String(revision))))revision++;
    if('markdown' in change){const folder=path.join(dir,String(revision));mkdirSync(folder,{mode:0o700});const fd=openSync(path.join(folder,'AGENTS.md'),'wx',0o600);try{writeFileSync(fd,change.markdown);fsyncSync(fd);}finally{closeSync(fd);}}
    const state={format:1,identity,revision,contentSha256:'markdown' in change?hash(change.markdown):current.contentSha256,enabled:'enabled' in change?change.enabled:current.enabled};
    temp=path.join(dir,`.state-${randomUUID()}`);const fd=openSync(temp,'wx',0o600);try{writeFileSync(fd,JSON.stringify(state));fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,path.join(dir,'state.json'));const parent=openSync(dir,'r');try{fsyncSync(parent);}finally{closeSync(parent);}
    return store.read(identity);
   }catch(error){if(temp)rmSync(temp,{force:true});if(error instanceof DomainError)throw error;throw new DomainError('PROJECT_RULES_UNAVAILABLE','项目规则保存失败，原配置保持不变',409,true);}
 }};return store;
}
export const projectRulesStore=createProjectRulesStore();
