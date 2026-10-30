import { createHash } from 'node:crypto';
import { DomainError } from '@/domain/errors';
export function botActionId(scope: string, key: string | null) {
  if (!key || key.length > 256) throw new DomainError('PRECONDITION_REQUIRED', '缺少动作幂等键', 428, true);
  return createHash('sha256').update(scope + '\0' + key).digest('hex');
}
