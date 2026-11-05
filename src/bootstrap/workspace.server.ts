import "server-only";
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { database } from '@/infrastructure/database/database.server';
import { createWorkspaceRepository } from '@/infrastructure/database/workspace-repository';
import { workspaceDirectories } from '@/infrastructure/workspaces/directories.server';
import { piSessionRuntime } from '@/infrastructure/pi/pi-session-runtime.server';
import { createWorkspaceService } from '@/application/workspace-service';
import { readWorkspaceFile } from '@/infrastructure/workspaces/file-preview.server';
import { DomainError } from '@/domain/errors';
function create() {
  const repository=createWorkspaceRepository(database);
  return createWorkspaceService({repository,directories:workspaceDirectories,runtime:piSessionRuntime,readFile:(workspaceId,projectId,relative)=>readWorkspaceFile(repository.get(workspaceId)!.projects,projectId,relative),listFiles:async(workspaceId,projectId,relative)=>{
    const {workspaceReferenceTarget}=await import('@/infrastructure/workspaces/reference-path.server');
    const workspace=repository.get(workspaceId)!;
    const {target}=await workspaceReferenceTarget(workspace.projects,projectId,relative);
    const entries=readdirSync(target,{withFileTypes:true});
    return {entries:entries.slice(0,1000).map(entry=>({name:entry.name,path:path.posix.join(relative,entry.name),parentPath:relative,type:entry.isDirectory()?'directory':'file'})),isGitRepository:false,truncated:entries.length>1000};
  },readReference:(workspaceId,reference)=>{
    const project=repository.get(workspaceId)?.projects.find(item=>item.id===reference.projectId);
    if(!project||path.isAbsolute(reference.path))throw new DomainError('PATH_OUTSIDE_WORKSPACE','参考文件不属于工作区',403,true);
    const root=realpathSync(project.rootPath),target=realpathSync(path.resolve(root,reference.path));
    if(target!==root&&!target.startsWith(root.endsWith(path.sep)?root:root+path.sep))throw new DomainError('PATH_OUTSIDE_WORKSPACE','参考文件越出项目目录',403,true);
    const stat=statSync(target);if(!stat.isFile()||stat.size>2*1024*1024)throw new DomainError('PAYLOAD_TOO_LARGE','参考文件过大或不是普通文件',413,true);
    return {name:path.basename(target),data:readFileSync(target).toString('base64')};
  }});
}
const globalState=globalThis as typeof globalThis & {__workspaceServicesV1?:ReturnType<typeof create>};
export const workspaceServices=globalState.__workspaceServicesV1??=create();
