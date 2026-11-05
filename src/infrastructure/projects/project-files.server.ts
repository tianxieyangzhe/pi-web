import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DomainError } from '@/domain/errors';
import { projectRepository } from '@/infrastructure/database/project-repository.server';
import type { ProjectMessageReference } from '@/domain/message-references';
export type GitFileStatus='added'|'modified'|'deleted'|'renamed'|'untracked'|'conflicted';
export type ProjectFileEntry={path:string;parentPath:string;name:string;type:'file'|'directory';gitStatus?:GitFileStatus};
export type ProjectChanges={isGitRepository:boolean;status:string;workingPatch:string;stagedPatch:string;truncated:boolean};
import {isProjectPathForbidden as forbidden} from './project-file-policy';
const inside=(root:string,target:string)=>target===root||target.startsWith(root.endsWith(path.sep)?root:root+path.sep);
function projectRoot(id:string){const project=projectRepository.get(id);if(!project)throw new DomainError('NOT_FOUND','项目不存在',404,true);try{return fs.realpathSync(project.rootPath);}catch{throw new DomainError('ROOT_UNAVAILABLE','项目目录当前不可用',409,true);}}
export function resolveProjectFile(root:string,relative:string,allowRoot=false){
  if(relative.includes('\0')||path.isAbsolute(relative)||relative.split(/[\\/]/).includes('..'))throw new DomainError('PATH_OUTSIDE_PROJECT','路径越出项目范围',403,true);
  if(!relative&&!allowRoot)throw new DomainError('INVALID_FILE','请选择文件',400,true);
  if(forbidden(relative))throw new DomainError('FILE_FORBIDDEN','此文件或目录不可读取',403,true);
  const requested=path.resolve(root,relative);if(!inside(root,requested))throw new DomainError('PATH_OUTSIDE_PROJECT','路径越出项目范围',403,true);
  let actual:string;try{actual=fs.realpathSync(requested);}catch{throw new DomainError('NOT_FOUND','文件或目录不存在',404,true);}
  if(!inside(root,actual))throw new DomainError('PATH_OUTSIDE_PROJECT','符号链接越出项目范围',403,true);
  if(forbidden(path.relative(root,actual)))throw new DomainError('FILE_FORBIDDEN','此文件或目录不可读取',403,true);
  return actual;
}
export function readProjectBytes(root:string,relative:string,limit:number){
  let fd:number|undefined;
  try{
    const target=resolveProjectFile(root,relative);fd=fs.openSync(target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const before=fs.fstatSync(fd),verified=fs.statSync(resolveProjectFile(root,relative));
    if(before.dev!==verified.dev||before.ino!==verified.ino)throw new DomainError('FILE_CHANGED','文件发生变化，请重试',409,true);
    if(!before.isFile())throw new DomainError('INVALID_FILE','只能读取普通文件',400,true);
    if(before.size>limit)throw new DomainError('FILE_TOO_LARGE','文件超过容量上限',413,true);
    const buffer=Buffer.alloc(before.size);let offset=0;
    while(offset<buffer.length){const n=fs.readSync(fd,buffer,offset,buffer.length-offset,offset);if(!n)break;offset+=n;}
    const after=fs.fstatSync(fd),resolved=fs.statSync(resolveProjectFile(root,relative));
    if(offset!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||resolved.dev!==before.dev||resolved.ino!==before.ino)throw new DomainError('FILE_CHANGED','文件发生变化，请重试',409,true);
    return buffer;
  }catch(error){if(error instanceof DomainError)throw error;throw new DomainError('FILE_READ_FAILED','无法完整读取文件',500,true);}
  finally{if(fd!==undefined)fs.closeSync(fd);}
}
function git(root:string,args:string[],maxBuffer=1024*1024,allowNotRepository=false){
  const result=spawnSync('git',['--no-optional-locks','-c','core.fsmonitor=false','-C',root,...args],{encoding:'buffer',timeout:10000,maxBuffer,stdio:['ignore','pipe','pipe'],env:{...process.env,LC_ALL:'C',GIT_OPTIONAL_LOCKS:'0',GIT_EXTERNAL_DIFF:''}});
  if(result.error&&(result.error as NodeJS.ErrnoException).code==='ETIMEDOUT')throw new DomainError('GIT_TIMEOUT','读取Git状态超时',504,true);
  if(allowNotRepository&&!result.error&&result.status===128&&/not a git repository/.test(result.stderr?.toString()??''))return {bytes:Buffer.from('false'),truncated:false};
  const truncated=!!result.error&&(result.error as NodeJS.ErrnoException).code==='ENOBUFS';
  if(!truncated&&(result.error||result.status!==0))throw new DomainError('GIT_READ_FAILED','无法读取Git状态',500,true);
  return {bytes:result.stdout??Buffer.alloc(0),truncated};
}
function gitRepository(root:string){return git(root,['rev-parse','--is-inside-work-tree'],4096,true).bytes.toString().trim()==='true';}
function gitMetadata(root:string){for(let current=root;;current=path.dirname(current)){if(fs.existsSync(path.join(current,'.git')))return true;if(path.dirname(current)===current)return false;}}
function statusMap(bytes:Buffer){const result=new Map<string,GitFileStatus>(),records=bytes.toString('utf8').split('\0');for(let i=0;i<records.length;i++){const record=records[i];if(record.length<4)continue;const code=record.slice(0,2),name=record.slice(3);const status:GitFileStatus=code==='??'?'untracked':code.includes('U')||['AA','DD'].includes(code)?'conflicted':/[RC]/.test(code)?'renamed':code.includes('A')?'added':code.includes('D')?'deleted':'modified';result.set(name,status);if(/[RC]/.test(code))i++;}return result;}
function utf8Prefix(bytes:Buffer,limit:number){const valid=Buffer.from(bytes.toString('utf8'));let end=Math.min(valid.length,Math.max(0,limit));while(end>0){try{return new TextDecoder('utf-8',{fatal:true}).decode(valid.subarray(0,end));}catch{end--;}}return '';}
export function readProjectReference(reference:ProjectMessageReference){const root=projectRoot(reference.projectId);return {name:path.basename(reference.path),data:readProjectBytes(root,reference.path,2*1024*1024).toString('base64')};}
export const projectFiles={
  list(projectId:string,relative=''){
    const root=projectRoot(projectId),directory=resolveProjectFile(root,relative,true),before=fs.statSync(directory);
    if(!before.isDirectory())throw new DomainError('INVALID_DIRECTORY','路径不是目录',400,true);
    const children=fs.readdirSync(directory,{withFileTypes:true}).filter(entry=>!forbidden(entry.name)&&!entry.isSymbolicLink()).sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||(a.name<b.name?-1:a.name>b.name?1:0));
    const after=fs.statSync(resolveProjectFile(root,relative,true));if(after.dev!==before.dev||after.ino!==before.ino||after.mtimeMs!==before.mtimeMs)throw new DomainError('FILE_CHANGED','目录发生变化，请重试',409,true);
    let repository=gitMetadata(root),gitState:'available'|'not_repository'|'unavailable'='unavailable',statuses=new Map<string,GitFileStatus>();
    try{repository=gitRepository(root);gitState=repository?'available':'not_repository';}catch{}
    if(repository&&gitState==='available')try{const status=git(root,['status','--porcelain=v1','-z','--untracked-files=all']);if(status.truncated)gitState='unavailable';else statuses=statusMap(status.bytes);}catch{gitState='unavailable';}
    const entries=children.slice(0,2000).map(child=>{const file=path.relative(root,path.join(directory,child.name));return {path:file,parentPath:relative,name:child.name,type:child.isDirectory()?'directory' as const:'file' as const,...(statuses.has(file)?{gitStatus:statuses.get(file)}:{})};});
    return {path:relative,entries,isGitRepository:repository,gitState,truncated:children.length>2000};
  },
  read(projectId:string,relative:string){const buffer=readProjectBytes(projectRoot(projectId),relative,512*1024);let content:string;try{if(buffer.includes(0))throw Error();content=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw new DomainError('BINARY_FILE','只支持UTF-8文本预览',415,true);}return {path:relative,content,size:buffer.length};},
  changes(projectId:string):ProjectChanges{
    const root=projectRoot(projectId);if(!gitRepository(root))return {isGitRepository:false,status:'',workingPatch:'',stagedPatch:'',truncated:false};
    const results=[git(root,['status','--porcelain=v1','--untracked-files=all']),git(root,['diff','--no-ext-diff','--no-textconv','--no-color']),git(root,['diff','--cached','--no-ext-diff','--no-textconv','--no-color'])];
    let remaining=1024*1024,truncated=results.some(result=>result.truncated);
    const [status,workingPatch,stagedPatch]=results.map(result=>{if(Buffer.byteLength(result.bytes.toString('utf8'))>remaining)truncated=true;const text=utf8Prefix(result.bytes,remaining);remaining-=Buffer.byteLength(text);return text;});
    return {isGitRepository:true,status,workingPatch,stagedPatch,truncated};
  },
};
