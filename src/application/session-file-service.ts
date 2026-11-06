import { DomainError } from '@/domain/errors';
import type { FileDownload, FilePreview } from '@/domain/file-preview';

type Owner = { nativeRef: Record<string, unknown> | null };
type Reader = (nativeId: string, path: string) => Promise<{ preview: FilePreview; download: FileDownload }>;
export function createSessionFileService(get: (ownerId: string, sessionId: string) => Owner | null | undefined, read: Reader) {
  async function file(ownerId: string, sessionId: string, path: string | null) {
    const session = get(ownerId, sessionId);
    if (!session) throw new DomainError('NOT_FOUND', '会话不存在', 404, true);
    if (!path) throw new DomainError('INVALID_PATH', '缺少文件路径', 400, true);
    const nativeId = session.nativeRef?.sessionId;
    if (typeof nativeId !== 'string' || !nativeId) throw new DomainError('NO_NATIVE_REF', '会话没有原生文件身份', 409, true);
    return read(nativeId, path);
  }
  return {
    preview: async (ownerId: string, sessionId: string, path: string | null) => (await file(ownerId, sessionId, path)).preview,
    download: async (ownerId: string, sessionId: string, path: string | null) => (await file(ownerId, sessionId, path)).download,
  };
}
