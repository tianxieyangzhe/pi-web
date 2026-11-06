import "server-only";
import { createSessionFileService } from "@/application/session-file-service";
import { readSessionFile } from "@/infrastructure/references/session-file-reader.server";
import { resolveProjectReferenceAt } from '@/infrastructure/projects/project-files.server';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { database } from '@/infrastructure/database/database.server';
import { createWorkspaceRepository } from '@/infrastructure/database/workspace-repository';
import { workspaceDirectories } from '@/infrastructure/workspaces/directories.server';
import { piSessionRuntime } from '@/infrastructure/pi/pi-session-runtime.server';
import {sessionOpenHistory} from '@/infrastructure/sessions/session-open-history.server';
import { createWorkspaceService } from '@/application/workspace-service';
import { readWorkspaceFile, downloadWorkspaceFile } from '@/infrastructure/workspaces/file-preview.server';
import { DomainError } from '@/domain/errors';
function create() {
  const repository=createWorkspaceRepository(database);
  return createWorkspaceService({sessionFiles:createSessionFileService((id,sid)=>repository.session(id,sid),readSessionFile),openHistory:sessionOpenHistory,preview:value=>piSessionRuntime.preview(value),repository,directories:workspaceDirectories,runtime:piSessionRuntime,downloadFile:(workspaceId,projectId,relative)=>downloadWorkspaceFile(repository.get(workspaceId)!.projects,projectId,relative),readFile:(workspaceId,projectId,relative)=>readWorkspaceFile(repository.get(workspaceId)!.projects,projectId,relative),listFiles:async(workspaceId,projectId,relative)=>{
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
