import { DomainError } from '@/domain/errors';
export function fileChangeSelection(request: Request, content: boolean): { runId: string; fileId: string } | undefined {
  const query = new URL(request.url).searchParams;
  if (!content) {
    if ([...query.keys()].length) throw new DomainError('INVALID_INPUT', '变更列表不接受查询参数', 400, true);
    return undefined;
  }
  if ([...query.keys()].some(key => !['runId', 'fileId'].includes(key)) || query.getAll('runId').length !== 1 || query.getAll('fileId').length !== 1 || ['runId', 'fileId'].some(key => !query.get(key)?.trim() || query.get(key)!.length > 256)) throw new DomainError('INVALID_INPUT', '请选择当前轮次的变更文件', 400, true);
  return { runId: query.get('runId')!, fileId: query.get('fileId')! };
}
