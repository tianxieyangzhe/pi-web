import path from 'node:path';
import { DomainError } from '@/domain/errors';
import { MAX_DOWNLOAD_BYTES } from '@/domain/file-preview';
import { readableSessionFile, sessionFileDirectory } from './session-files.server';
import { readProjectBytes } from '@/infrastructure/projects/project-files.server';
import { previewFile } from './file-preview.server';

export async function readSessionFile(nativeId: string, locator: string) {
  const scope = sessionFileDirectory(nativeId), target = path.resolve(scope, locator), relative = path.relative(scope, target);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || locator.includes('\0')) throw new DomainError('PATH_OUTSIDE_SESSION', '文件不属于当前会话目录', 403, true);
  try {
    await readableSessionFile(target, scope);
    const bytes = readProjectBytes(scope, relative, MAX_DOWNLOAD_BYTES);
    await readableSessionFile(target, scope);
    return { preview: previewFile(relative, bytes), download: { name: path.basename(relative), bytes } };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new DomainError('NOT_FOUND', '会话文件不存在', 404, true);
    throw new DomainError('PATH_OUTSIDE_SESSION', '会话文件路径无效或包含符号链接', 403, true);
  }
}
