import {projectRulesStore} from '@/infrastructure/agents/project-rules-store.server';
import {projectRepository} from '@/infrastructure/database/project-repository.server';
import { createSessionAssistantAccess } from "@/application/session-assistant-service";
import { sessionAssistantStore } from "@/infrastructure/agents/session-assistant-store.server";
import { agentRepository } from "@/infrastructure/database/agent-repository.server";
import "server-only";
import { createSessionFileService } from "@/application/session-file-service";
import { readSessionFile } from "@/infrastructure/references/session-file-reader.server";
import { resolveProjectReferenceAt, readProjectBytes } from '@/infrastructure/projects/project-files.server';
import { sessionContextFiles } from '@/infrastructure/references/session-context-files.server';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { database, assertSchemaCompatible } from '@/infrastructure/database/database.server';
import { createWorkspaceRepository } from '@/infrastructure/database/workspace-repository';
import { workspaceDirectories } from '@/infrastructure/workspaces/directories.server';
import { piSessionRuntime } from '@/infrastructure/pi/pi-session-runtime.server';
import {sessionOpenHistory} from '@/infrastructure/sessions/session-open-history.server';
import { createWorkspaceService } from '@/application/workspace-service';
import { readWorkspaceFile, downloadWorkspaceFile } from '@/infrastructure/workspaces/file-preview.server';
import { DomainError } from '@/domain/errors';
function create() {
  const repository=createWorkspaceRepository(database);
  return createWorkspaceService({projectRules:projectRulesStore,findProject:id=>projectRepository.get(id),assistants:createSessionAssistantAccess(sessionAssistantStore,(id,revision,hash)=>agentRepository.getVersion(id,revision,hash),(identity,agent)=>{const definition=agent.definition;if(definition?.format===4&&definition.source?.kind==='project'){const current=repository.get(identity.ownerId),source=projectRepository.get(definition.source.projectId);if(!current||!source||!current.projects.some(p=>p.id===source.id||p.rootPath===source.rootPath))throw new DomainError('ROLE_BINDING_INVALID','助手项目不属于当前工作区',409,true);}if(definition?.scope==='workspace'){const current=repository.get(identity.ownerId);if(!current||(definition.source?.kind==='workspace'&&definition.source.projectIds?.some(id=>!current.projects.some(item=>item.id===id)))||definition.projects?.some(p=>!current?.projects.some(item=>item.id===p.id)))throw new DomainError('ROLE_BINDING_INVALID','助手项目已不属于当前工作区',409,true);}}),contextFiles:sessionContextFiles,assertWritable:assertSchemaCompatible,
    readContextFile:(workspaceId,reference)=>{
      const project=repository.get(workspaceId)?.projects.find(item=>item.id===reference.projectId);
      if(!project)throw new DomainError('REFERENCE_OUTSIDE_SCOPE','参考项目不属于当前工作区',403,true);
      return {name:reference.path.split('/').at(-1)!,bytes:readProjectBytes(project.rootPath,reference.path,50_000_000)};
    },sessionFiles:createSessionFileService((id,sid)=>repository.session(id,sid),readSessionFile),openHistory:sessionOpenHistory,preview:value=>piSessionRuntime.preview(value),repository,directories:workspaceDirectories,runtime:piSessionRuntime,downloadFile:(workspaceId,projectId,relative)=>downloadWorkspaceFile(repository.get(workspaceId)!.projects,projectId,relative),readFile:(workspaceId,projectId,relative)=>readWorkspaceFile(repository.get(workspaceId)!.projects,projectId,relative),listFiles:async(workspaceId,projectId,relative)=>{
    const {workspaceReferenceTarget}=await import('@/infrastructure/workspaces/reference-path.server');
    const workspace=repository.get(workspaceId)!;
    const {target}=await workspaceReferenceTarget(workspace.projects,projectId,relative);
    const entries=readdirSync(target,{withFileTypes:true});
    return {entries:entries.slice(0,1000).map(entry=>({name:entry.name,path:path.posix.join(relative,entry.name),parentPath:relative,type:entry.isDirectory()?'directory':'file'})),isGitRepository:false,truncated:entries.length>1000};
  },resolveReference:(workspaceId,reference)=>{
    const project=repository.get(workspaceId)?.projects.find(item=>item.id===reference.projectId);
    if(!project||path.isAbsolute(reference.path))throw new DomainError('PATH_OUTSIDE_WORKSPACE','参考文件不属于工作区',403,true);
    return resolveProjectReferenceAt(project.rootPath,reference.path);
  }});
}
const globalState=globalThis as typeof globalThis & {__workspaceServicesV1?:ReturnType<typeof create>};
export const workspaceServices=globalState.__workspaceServicesV1??=create();
