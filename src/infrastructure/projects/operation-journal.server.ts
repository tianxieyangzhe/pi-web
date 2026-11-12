import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DomainError } from '@/domain/errors';
import type { ProjectOperationStore, OperationRecord } from '@/application/ports/project-operations';
import type { SessionOperation } from '@/domain/session-tools';
import { canonical, hash, operationIdentity } from '@/domain/project-operations';
export { canonical, hash, createdSessionId, operationIdentity } from '@/domain/project-operations';
export const unknownOperation = () => new DomainError('REQUEST_UNKNOWN', '操作证据不完整，请先核对；不会自动重放',409,true);
function syncDirectory(directory: string) { const fd=openSync(directory,'r');try{fsyncSync(fd);}finally{closeSync(fd);} }
export function createProjectOperationStore(root = path.join(process.cwd(),'.data')): ProjectOperationStore {
  const folder=(projectId:string)=>path.join(root,'project-session-operations',hash(projectId));
  const location=(projectId:string,id:string)=>{if(!/^[a-f0-9]{64}$/.test(id))throw new DomainError('INVALID_INPUT','操作ID无效',400,true);return path.join(folder(projectId),id+'.jsonl');};
  const store: ProjectOperationStore = {
    read(projectId,id) {
      const file=location(projectId,id);let bytes:Buffer;
      try{bytes=readFileSync(file);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw unknownOperation();}
      try {
        const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!text.endsWith('\n'))throw unknownOperation();
        let previous:OperationRecord|undefined;
        return text.slice(0,-1).split('\n').map(line=>{
          const record=JSON.parse(line) as OperationRecord;const {recordHash,...unsigned}=record;
          if(record.version!==1||record.operationId!==id||record.projectId!==projectId||record.sequence!==(previous?.sequence??0)+1||record.previousHash!==(previous?.recordHash??null)||recordHash!==hash(canonical(unsigned))||!['prepared','observed','completed','failed','acknowledged'].includes(record.phase)||!record.sessionId||!record.evidence||typeof record.evidence!=='object')throw unknownOperation();
          if(!/^[a-f0-9]{64}$/.test(record.keyHash)||!/^[a-f0-9]{64}$/.test(record.payloadSha256)||Array.isArray(record.evidence)||!['create','open','message','steer','interrupt','end','restore','switch-model','compact','compact-cancel','fork','adopt-agent','recover'].includes(record.operation)||!previous&&record.phase!=='prepared'||previous&&['completed','failed','acknowledged'].includes(previous.phase))throw unknownOperation();
          if(previous&&(previous.payloadSha256!==record.payloadSha256||previous.keyHash!==record.keyHash||previous.sessionId!==record.sessionId||previous.operation!==record.operation))throw unknownOperation();
          previous=record;return record;
        });
      }catch{throw unknownOperation();}
    },
    prepare(projectId,sessionId,operation,key,payload,evidence={}) {
      const operationId=operationIdentity(projectId,sessionId,operation,key),payloadSha256=hash(canonical(payload));
      const old=this.read(projectId,operationId);
      if(old.length){if(old[0].payloadSha256!==payloadSha256)throw new DomainError('IDEMPOTENCY_CONFLICT','同一幂等键不能用于不同内容',409,true);return old.at(-1)!;}
      const directory=folder(projectId);mkdirSync(directory,{recursive:true,mode:0o700});
      syncDirectory(path.dirname(directory));syncDirectory(root);
      const unsigned={version:1 as const,sequence:1,previousHash:null,timestamp:new Date().toISOString(),operationId,projectId,sessionId,operation,keyHash:hash(key),payloadSha256,phase:'prepared' as const,evidence};
      const record={...unsigned,recordHash:hash(canonical(unsigned))};
      let fd:number;try{fd=openSync(location(projectId,operationId),'wx',0o600);}catch{throw unknownOperation();}
      try{writeFileSync(fd,JSON.stringify(record)+'\n');fsyncSync(fd);}finally{closeSync(fd);}syncDirectory(directory);return record;
    },
    append(record,phase,evidence={}) {
      const current=this.read(record.projectId,record.operationId).at(-1);if(!current||current.recordHash!==record.recordHash)throw unknownOperation();
      if(['completed','failed','acknowledged'].includes(current.phase))throw unknownOperation();
      const {recordHash,...base}=current;
      const unsigned={...base,sequence:current.sequence+1,previousHash:recordHash,timestamp:new Date().toISOString(),phase,evidence:{...current.evidence,...evidence}};
      const next={...unsigned,recordHash:hash(canonical(unsigned))};
      const fd=openSync(location(record.projectId,record.operationId),'a');try{writeFileSync(fd,JSON.stringify(next)+'\n');fsyncSync(fd);}finally{closeSync(fd);}return next;
    },
    list(projectId,sessionId) {
      const directory=folder(projectId);if(!existsSync(directory))return [];
      const result:OperationRecord[]=[];
      for(const name of readdirSync(directory).sort()){
        if(!/^[a-f0-9]{64}\.jsonl$/.test(name))throw unknownOperation();
        const record=this.read(projectId,name.slice(0,-6)).at(-1);if(record&&(!sessionId||record.sessionId===sessionId))result.push(record);
      }
      return result;
    },
    directory(record){return path.join(root,'project-session-forks',record.operationId);},
  };
  return store;
}
