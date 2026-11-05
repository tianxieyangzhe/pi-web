import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { DomainError } from '@/domain/errors';
import type { WorkspaceProject } from '@/domain/workspace';
import { workspaceReferenceTarget } from './reference-path.server';

export async function readWorkspaceFile(projects: WorkspaceProject[], projectId: string, relative: string) {
  try {
    const { target } = await workspaceReferenceTarget(projects, projectId, relative);
    const actual = await fs.realpath(target);
    const file = await fs.open(actual, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      await workspaceReferenceTarget(projects, projectId, relative);
      const current = await fs.stat(target);
      if (stat.dev !== current.dev || stat.ino !== current.ino) throw new DomainError('NOT_FOUND', '文件路径已变化，请重试', 404, true);
      if (!stat.isFile()) throw new DomainError('INVALID_FILE', '只能预览普通文件', 400, true);
      const limit = 512 * 1024;
      if (stat.size > limit) throw new DomainError('FILE_TOO_LARGE', '文件超过 512KiB 预览上限', 413, true);
      const buffer = Buffer.alloc(limit + 1);
      let size = 0;
      while (size < buffer.length) { const result = await file.read(buffer, size, buffer.length - size, null); if (!result.bytesRead) break; size += result.bytesRead; }
      if (size > limit) throw new DomainError('FILE_TOO_LARGE', '文件超过预览上限', 413, true);
      const bytes = buffer.subarray(0, size);
      let content: string;
      try { if (bytes.includes(0)) throw new Error(); content = new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
      catch { throw new DomainError('BINARY_FILE', '此文件不是可预览的 UTF-8 文本', 415, true); }
      return {path:relative,content,size};
    } finally { await file.close(); }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError('NOT_FOUND', '文件不存在或无法读取', 404, true);
  }
}
