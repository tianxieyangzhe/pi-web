import type { MessageReference } from '../../src/domain/message-references';
import type { SessionContextFilesView } from '../../src/application/ports/session-context-files';

export async function sessionContextFilesRequest(base: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', options?: { lease: string; etag: string; references?: MessageReference[]; id?: string }): Promise<SessionContextFilesView> {
  const response = await fetch(`${base}/context-files`, {
    method, cache: 'no-store',
    ...(options ? {
      headers: { 'content-type': 'application/json', 'x-session-lease-id': options.lease, 'if-match': options.etag },
      body: JSON.stringify(method === 'POST' ? { references: options.references } : { id: options.id }),
    } : {}),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? '参考文件操作失败');
  return payload.data;
}
