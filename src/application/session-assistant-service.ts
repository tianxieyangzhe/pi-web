import { DomainError } from '@/domain/errors';
import { snapshot,snapshotReference } from '@/domain/agent-definition';
import type { Agent,AgentSnapshot } from '@/domain/models';
import type { AssistantIdentity,SessionAssistantAccess,SessionAssistantStore } from './ports/session-assistant';
export function createSessionAssistantAccess(store:SessionAssistantStore,version:(id:string,revision:number,hash:string)=>Agent|null,validate?:(identity:AssistantIdentity,agent:Agent)=>void):SessionAssistantAccess {
  function resolveSelection(identity:AssistantIdentity,ref:ReturnType<typeof snapshotReference>|null,active:boolean):AgentSnapshot|null {
    if(!ref)return null;const agent=version(ref.agentId,ref.revision,ref.contentSha256);
    if(!agent||active&&agent.status!=='active')throw new DomainError('ROLE_UNAVAILABLE','助手版本不可用',409,true);
    const result=snapshot(agent),definition=result.definition;
    if(identity.scope==='project'&&definition.scope==='workspace'||identity.scope==='workspace'&&definition.scope==='workspace'&&(definition.source?.kind!=='workspace'||definition.source.workspaceId!==identity.ownerId))throw new DomainError('ROLE_BINDING_INVALID','助手不适用于当前范围',409,true);
    if(definition.format===4&&definition.scope!=='global'&&identity.scope==='project'&&(definition.source?.kind!=='project'||definition.source.projectId!==identity.ownerId))throw new DomainError('ROLE_BINDING_INVALID','助手不适用于此项目',409,true);
    validate?.(identity,agent);
    return result;
  }
  return {
    read:(identity,fallback)=>store.read(identity,fallback?snapshotReference(fallback):null),
    resolve(identity,fallback){return resolveSelection(identity,store.read(identity,fallback?snapshotReference(fallback):null).selection,false);},
    write(identity,body,etag,fallback){
      if(Object.keys(body).some(k=>k!=='selection')||!Object.hasOwn(body,'selection'))throw new DomainError('INVALID_INPUT','请选择助手或明确移除',400,true);
      let selection=null;
      if(body.selection!==null){const ref=body.selection as Record<string,unknown>;
        if(!ref||typeof ref!=='object'||Array.isArray(ref)||Object.keys(ref).some(k=>!['agentId','revision','contentSha256'].includes(k))||typeof ref.agentId!=='string'||!ref.agentId||!Number.isInteger(ref.revision)||Number(ref.revision)<1||typeof ref.contentSha256!=='string'||!/^[a-f0-9]{64}$/.test(ref.contentSha256))throw new DomainError('INVALID_INPUT','助手版本引用无效',400,true);
        const agent=version(ref.agentId,Number(ref.revision),ref.contentSha256);if(!agent)throw new DomainError('NOT_FOUND','助手不存在',404,true);
        selection=snapshotReference(snapshot(agent));resolveSelection(identity,selection,true);
      }
      return store.write(identity,selection,etag,fallback?snapshotReference(fallback):null);
    },
  };
}
