import fs from 'node:fs';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { DomainError } from '@/domain/errors';
import { validateSnapshotReference } from '@/domain/agent-definition';
import type { AgentSnapshotRef } from '@/domain/models';
import type { AssistantIdentity,SessionAssistantStore } from '@/application/ports/session-assistant';
import { applicationConfigRoot } from '@/infrastructure/application-config-root';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function createSessionAssistantStore(root:string):SessionAssistantStore {
  const file=(identity:AssistantIdentity)=>path.join(root,digest(identity)+'.json');
  const failure=()=>new DomainError('ASSISTANT_UNAVAILABLE','无法读取或保存会话助手',503,true);
  function load(identity:AssistantIdentity,fallback:AgentSnapshotRef|null=null){
    const target=file(identity);
    if(!fs.existsSync(target))return {version:1,...identity,selection:fallback};
    try{
      if(fs.lstatSync(root).isSymbolicLink())throw failure();
      const stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw failure();
      const v=JSON.parse(fs.readFileSync(target,'utf8'));
      if(v.version!==1||v.scope!==identity.scope||v.ownerId!==identity.ownerId||v.sessionId!==identity.sessionId)throw failure();
      if(v.selection!==null)validateSnapshotReference(v.selection);return v;
    }catch{throw failure();}
  }
  const view=(v:ReturnType<typeof load>)=>({selection:v.selection as AgentSnapshotRef|null,writeETag:`"${digest(v)}"`});
  return {
    read:(identity,fallback)=>view(load(identity,fallback)),
    write(identity,selection,etag,fallback){
      if(!etag)throw new DomainError('PRECONDITION_REQUIRED','缺少If-Match',428,true);
      const previous=load(identity,fallback);if(view(previous).writeETag!==etag)throw new DomainError('WRITE_CONFLICT','会话助手已变化，请刷新',409,true);
      const next={...previous,selection};let temporary:string|undefined;
      try{
        fs.mkdirSync(root,{recursive:true,mode:0o700});if(fs.lstatSync(root).isSymbolicLink())throw failure();
        temporary=path.join(root,`.${randomUUID()}.tmp`);const fd=fs.openSync(temporary,'wx',0o600);
        try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
        fs.renameSync(temporary,file(identity));temporary=undefined;const fdRoot=fs.openSync(root,'r');try{fs.fsyncSync(fdRoot);}finally{fs.closeSync(fdRoot);}
        return view(next);
      }catch{throw failure();}finally{if(temporary&&fs.existsSync(temporary))fs.unlinkSync(temporary);}
    },
    inUse(agentId){
      if(!fs.existsSync(root))return false;
      for(const name of fs.readdirSync(root)){if(!/^[a-f0-9]{64}\.json$/.test(name))continue;try{const v=JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));if(v.selection?.agentId===agentId)return true;}catch{throw failure();}}
      return false;
    },
  };
}
export const sessionAssistantStore=createSessionAssistantStore(path.join(applicationConfigRoot,'.data','session-assistants'));
