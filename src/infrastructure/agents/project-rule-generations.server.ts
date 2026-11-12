import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,rmSync} from 'node:fs';
import path from 'node:path';
import {DomainError} from '@/domain/errors';
import type {ProjectRuleIdentity} from '@/application/ports/project-rules';
import type {ProjectRuleGenerationsStore,StoredProjectRuleGeneration} from '@/application/ports/project-rule-generations';
const identityKey=(id:ProjectRuleIdentity)=>JSON.stringify(id.scope==='project'?['project',id.projectId]:['workspace',id.workspaceId,id.projectId]);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function createProjectRuleGenerationsStore(root=path.join(process.env.AI_WORKSPACE_AGENT_DIR??path.join(process.cwd(),'agents'),'project-rules')):ProjectRuleGenerationsStore {
 const directory=(id:ProjectRuleIdentity)=>path.resolve(root,createHash('sha256').update(identityKey(id)).digest('hex'),'generations');
 const assertDirectory=(dir:string)=>{for(let p=dir;p!==path.dirname(p);p=path.dirname(p)){if(existsSync(p)&&(!lstatSync(p).isDirectory()||lstatSync(p).isSymbolicLink()))throw Error('invalid directory');if(p===path.resolve(root))break;}};
 const validate=(task:StoredProjectRuleGeneration)=>{
  if(!task||task.mode!==undefined&&!['generate','revise'].includes(task.mode)||!uuid.test(task.id)||!['queued','running','cancelling','publishing','succeeded','failed','cancelled','interrupted'].includes(task.status)||typeof task.requirements!=='string'||task.requirements.length>4000||task.skillId!==null&&(typeof task.skillId!=='string'||!/^[a-z0-9][a-z0-9-]{0,99}$/.test(task.skillId))||typeof task.requestKey!=='string'||!task.requestKey||task.requestKey.length>128||typeof task.baseETag!=='string'||!Number.isInteger(task.inputRevision)||task.inputRevision<0||!Number.isFinite(Date.parse(task.createdAt))||!Number.isFinite(Date.parse(task.updatedAt))||task.resultSha256!==null&&!/^[a-f0-9]{64}$/.test(task.resultSha256))throw Error('invalid generation');
 };
 return {list(identity){try{
  const dir=directory(identity);assertDirectory(dir);if(!existsSync(dir))return [];
  return readdirSync(dir).filter(name=>name.endsWith('.json')).map(name=>{
   if(!uuid.test(name.slice(0,-5)))throw Error('invalid name');const file=path.join(dir,name),stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32768)throw Error('invalid file');
   const record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(file)));if(record.format!==1||identityKey(record.identity)!==identityKey(identity)||record.task?.id!==name.slice(0,-5))throw Error('invalid record');validate(record.task);return record.task as StoredProjectRuleGeneration;
  }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
 }catch{throw new DomainError('PROJECT_RULE_GENERATIONS_UNAVAILABLE','无法读取项目规则生成状态',503,true);}},
 save(identity,task){let temp='';try{
  validate(task);const dir=directory(identity);assertDirectory(dir);mkdirSync(dir,{recursive:true,mode:0o700});
  const file=path.join(dir,task.id+'.json');if(existsSync(file)){const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('invalid target');}
  temp=path.join(dir,'.'+randomUUID());const fd=openSync(temp,'wx',0o600);try{writeFileSync(fd,JSON.stringify({format:1,identity,task}));fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,file);temp='';const parent=openSync(dir,'r');try{fsyncSync(parent);}finally{closeSync(parent);}
 }catch{if(temp)rmSync(temp,{force:true});throw new DomainError('PROJECT_RULE_GENERATIONS_UNAVAILABLE','无法保存项目规则生成状态',503,true);}}
 };
}
