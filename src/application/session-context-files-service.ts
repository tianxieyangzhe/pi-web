import { DomainError } from '@/domain/errors';
import type { ProjectMessageReference } from '@/domain/message-references';
import type { SessionContextFilesStore } from './ports/session-context-files';

export function changeSessionContextFiles(store: SessionContextFilesStore, sessionId: string, method: 'POST' | 'DELETE', body: Record<string, unknown>, etag: string, resolve: Parameters<SessionContextFilesStore['add']>[3]) {
  const fields = method === 'POST' ? ['references'] : ['id'];
  if (Object.keys(body).some(key => !fields.includes(key))) throw new DomainError('INVALID_INPUT', '参考文件请求包含未知字段', 400, true);
  if (method === 'DELETE') {
    if (typeof body.id !== 'string' || !body.id) throw new DomainError('INVALID_INPUT', '缺少参考文件 ID', 400, true);
    return store.remove(sessionId, body.id, etag);
  }
  if (!Array.isArray(body.references) || body.references.some(item => !item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['projectId', 'path'].includes(key)))) throw new DomainError('INVALID_REFERENCES', '参考文件格式无效', 400, true);
  return store.add(sessionId, body.references as ProjectMessageReference[], etag, resolve);
}
