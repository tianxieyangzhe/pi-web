import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {closeSync,fsyncSync,mkdirSync,openSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {DomainError} from '@/domain/errors';
import type {SessionOpenHistory,SessionOpenIdentity} from '@/application/ports/session-open-history';
export function createSessionOpenHistory(root=path.join(process.cwd(),'.data'),now=()=>Date.now()):SessionOpenHistory {
 const folder=path.join(root,'session-opened');
 const file=(identity:SessionOpenIdentity)=>path.join(folder,createHash('sha256').update(JSON.stringify([identity.scope,identity.ownerId,identity.sessionId])).digest('hex')+'.json');
 const syncDirectory=(directory:string)=>{const fd=openSync(directory,'r');try{fsyncSync(fd);}finally{closeSync(fd);}};
 function get(identity:SessionOpenIdentity):string|null {
  try{const record=JSON.parse(readFileSync(file(identity),'utf8'));if(!record||Object.keys(record).sort().join(',')!=='openedAt,ownerId,scope,sessionId,version'||record.version!==1||record.scope!==identity.scope||record.ownerId!==identity.ownerId||record.sessionId!==identity.sessionId||typeof record.openedAt!=='string'||!Number.isFinite(Date.parse(record.openedAt))||new Date(record.openedAt).toISOString()!==record.openedAt)throw new Error('invalid record');return record.openedAt;}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw new DomainError('SESSION_OPEN_TIME_READ_FAILED','最后打开时间读取失败，请检查会话打开记录',500,true);}
 }
 return {get,record(identity){const previous=get(identity),openedAt=new Date(Math.max(now(),previous?Date.parse(previous):0)).toISOString();let temporary:string|undefined;
  try{mkdirSync(folder,{recursive:true,mode:0o700});syncDirectory(root);temporary=file(identity)+'.'+randomUUID()+'.tmp';const fd=openSync(temporary,'wx',0o600);try{writeFileSync(fd,JSON.stringify({version:1,...identity,openedAt})+'\n','utf8');fsyncSync(fd);}finally{closeSync(fd);}renameSync(temporary,file(identity));temporary=undefined;syncDirectory(folder);}
  catch{throw new DomainError('SESSION_OPEN_TIME_WRITE_FAILED','最后打开时间保存失败，请重试打开会话',500,true);}
  finally{if(temporary)try{unlinkSync(temporary);}catch{/* The original record remains intact. */}}
 }};
}
export const sessionOpenHistory=createSessionOpenHistory();
