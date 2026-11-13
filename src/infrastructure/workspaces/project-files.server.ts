import type { WorkspaceProject } from '@/domain/workspace';
import { listProjectFilesAt, readProjectChangesAt } from '@/infrastructure/projects/project-files.server';
import { workspaceReferenceTarget } from './reference-path.server';

export async function listWorkspaceProjectFiles(projects: WorkspaceProject[], projectId: string, relative: string) {
  const { target: root } = await workspaceReferenceTarget(projects, projectId, '');
  return listProjectFilesAt(root, relative);
}
export async function readWorkspaceProjectChanges(projects: WorkspaceProject[], projectId: string) {
  const { target: root } = await workspaceReferenceTarget(projects, projectId, '');
  return readProjectChangesAt(root);
}
