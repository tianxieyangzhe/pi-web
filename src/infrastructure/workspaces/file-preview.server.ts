import fs from 'node:fs/promises';
import path from 'node:path';
import { DomainError } from '@/domain/errors';
import { MAX_DOWNLOAD_BYTES } from '@/domain/file-preview';
import type { WorkspaceProject } from '@/domain/workspace';
import { workspaceReferenceTarget } from './reference-path.server';
import { readProjectBytes } from '@/infrastructure/projects/project-files.server';
import { previewFile } from '@/infrastructure/references/file-preview.server';

export async function downloadWorkspaceFile(projects: WorkspaceProject[], projectId: string, relative: string) {
  try {
    const { project } = await workspaceReferenceTarget(projects, projectId, relative);
    const bytes = readProjectBytes(project.rootPath, relative, MAX_DOWNLOAD_BYTES);
    if (await fs.realpath(project.rootPath) !== path.resolve(project.rootPath)) throw new DomainError('PATH_OUTSIDE_WORKSPACE', '项目根目录身份已变化', 403, true);
    return { name: path.basename(relative), bytes };
  } catch (error) {
    if (error instanceof DomainError) {
      if (error.code === 'PATH_OUTSIDE_PROJECT') throw new DomainError('PATH_OUTSIDE_WORKSPACE', '路径越出工作区项目范围', 403, true);
      throw error;
    }
    throw new DomainError('NOT_FOUND', '文件不存在或无法读取', 404, true);
  }
}
export async function readWorkspaceFile(projects: WorkspaceProject[], projectId: string, relative: string) {
  const { bytes } = await downloadWorkspaceFile(projects, projectId, relative);
  return previewFile(relative, bytes);
}
