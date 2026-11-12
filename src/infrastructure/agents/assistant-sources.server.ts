import { DomainError } from '@/domain/errors';
import type { AssistantSource } from '@/domain/assistant-document';
import { projectRepository } from '@/infrastructure/database/project-repository.server';
import { database } from '@/infrastructure/database/database.server';
import { createWorkspaceRepository } from '@/infrastructure/database/workspace-repository';
export function resolveAssistantSource(source:AssistantSource|import('@/domain/assistant-document').UnifiedAssistantDefinition['source']){
  if(source===null)return [];
  const projects=source.kind==='project'?(()=>{const p=projectRepository.get(source.projectId);if(!p||p.status!=='active')throw new DomainError('NOT_FOUND','项目不可用',404,true);return [p];})():(()=>{
    const w=createWorkspaceRepository(database).get(source.workspaceId);if(!w)throw new DomainError('NOT_FOUND','工作区不存在',404,true);
    return (source.projectIds??w.projects.map(p=>p.id)).map(id=>{const p=w.projects.find(p=>p.id===id);if(!p)throw new DomainError('REFERENCE_OUTSIDE_SCOPE','项目不属于所选工作区',403,true);return p;});
  })();
  return projects.map(p=>({id:p.id,name:p.name,rootPath:p.rootPath}));
}
