import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DomainError } from '@/domain/errors';
import { applicationConfigRoot } from '@/infrastructure/application-config-root';
import { documentText } from './document-text.server';

const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export const sessionFilesRoot=path.join(applicationConfigRoot,'.data','session-files');
export function sessionFileDirectory(sessionId:string,root=sessionFilesRoot){
  if(!sessionId)throw new DomainError('REFERENCE_STORE_FAILED','附件缺少所属Pi会话身份',500,true);
  return path.join(root,digest(sessionId));
}
function directory(target:string){
  try{fs.mkdirSync(target,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  const stat=fs.lstatSync(target);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('附件目录身份无效');
}
function immutable(target:string,bytes:Buffer){
  let fd:number|undefined;
  try{fd=fs.openSync(target,'wx',0o400);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}
  catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    const stat=fs.lstatSync(target);if(stat.isSymbolicLink()||!stat.isFile()||stat.size!==bytes.length||!fs.readFileSync(target).equals(bytes))throw Error('已有附件内容或身份不匹配');
  }finally{if(fd!==undefined)fs.closeSync(fd);}
}
export function storeSessionFile(sessionId:string,name:string,data:string,root=sessionFilesRoot){
  try{
    const bytes=Buffer.from(data,'base64'),id=createHash('sha256').update(name).update('\0').update(bytes).digest('hex');
    fs.mkdirSync(path.dirname(root),{recursive:true,mode:0o700});if(fs.lstatSync(path.dirname(root)).isSymbolicLink())throw Error('附件父目录不能是符号链接');directory(root);
    const scope=sessionFileDirectory(sessionId,root);directory(scope);const folder=path.join(scope,id);directory(folder);
    const extension=path.extname(name).toLowerCase(),safeExtension=/^\.[a-z0-9]{1,12}$/.test(extension)?extension:'.bin';
    const originalPath=path.join(folder,`original${safeExtension}`);immutable(originalPath,bytes);
    const extracted=documentText(name,bytes);let readPath=originalPath;
    if(extracted.text!==undefined){readPath=path.join(folder,'content.txt');immutable(readPath,Buffer.from(extracted.text));}
    return {name,originalPath,readPath,note:extracted.note};
  }catch(error){if(error instanceof DomainError)throw error;throw new DomainError('REFERENCE_STORE_FAILED','无法安全保存或核验会话附件，请检查应用存储目录',500,true);}
}
export async function readableSessionFile(target:string,scope:string){
  const absolute=path.resolve(target),relative=path.relative(scope,absolute);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('附件不属于当前Pi会话');
  if((await fs.promises.lstat(path.dirname(scope))).isSymbolicLink())throw Error('附件根目录不能是符号链接');
  let current=scope;
  for(const segment of ['',...relative.split(path.sep)]){
    current=segment?path.join(current,segment):current;
    if((await fs.promises.lstat(current)).isSymbolicLink())throw Error('附件不允许通过符号链接读取');
  }
  const [actual,base]=await Promise.all([fs.promises.realpath(absolute),fs.promises.realpath(scope)]);
  if(!actual.startsWith(base+path.sep)||(await fs.promises.stat(actual)).isFile()===false)throw Error('附件路径无效');
  return actual;
}
