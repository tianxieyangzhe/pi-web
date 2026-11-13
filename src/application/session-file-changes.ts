import path from 'node:path';
import { DomainError } from '@/domain/errors';
import type { FileChangeContent, NativeEdit, SessionFileChanges } from '@/domain/session-file-changes';

type Entry = { id: string; parentId?: string | null; type?: string; message?: { role?: string; toolName?: string; toolCallId?: string; isError?: boolean; details?: { diff?: unknown; firstChangedLine?: unknown }; content?: unknown } };
export type NativeEditRound = { runId: string; before: unknown; after?: unknown; running: boolean };
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.every(id => typeof id === 'string') && new Set(value).size === value.length;

/** Project existing native evidence only. Never access project files or generate a diff. */
export function sessionFileChanges(entries: ReadonlyArray<{ entry: unknown }>, round: NativeEditRound | null, selection?: { runId: string; fileId: string }, roots: readonly string[] = []): SessionFileChanges | FileChangeContent {
  if (selection && selection.runId !== round?.runId) throw new DomainError('CHANGE_RUN_REPLACED', '已切换到新一轮，请重新选择编辑差异', 409, true);
  const native = entries.map(item => item.entry as Entry);
  const byId = new Map(native.map(entry => [entry.id, entry]));
  const available = !!round && ids(round.before) && (round.after === undefined || ids(round.after)) && [...round.before, ...(round.after as string[] | undefined ?? [])].every(id => byId.has(id)) && (round.after === undefined || round.before.every(id => (round.after as string[]).includes(id)));
  if (!available) {
    if (selection) throw new DomainError('NOT_FOUND', '本轮没有可确认的原生编辑差异', 404, true);
    const empty = !round && !native.length;
    return { runId: round?.runId ?? null, status: empty ? 'not_recorded' : 'boundary_unavailable', notice: empty ? '此会话尚无原生编辑记录。' : '缺少可信的本轮执行边界，无法确认哪些原生编辑属于本轮。', files: [] };
  }
  const before = new Set(round!.before as string[]), after = round!.after === undefined ? null : new Set(round!.after as string[]);
  const selected = new Set(native.filter(entry => !before.has(entry.id) && (!after || after.has(entry.id))).map(entry => entry.id));
  const paths = roots.length && /^[a-z]:[\\/]/i.test(roots[0]) ? path.win32 : path.posix;
  const groups = new Map<string, { id: string; path: string; edits: NativeEdit[] }>();
  for (const entry of native) {
    const message = entry.message;
    if (!selected.has(entry.id) || entry.type !== 'message' || message?.role !== 'toolResult' || message.toolName !== 'edit' || message.isError === true || typeof message.details?.diff !== 'string' || !message.details.diff) continue;
    // Match only an ancestor tool call, so identical call IDs on sibling branches cannot steal the path.
    let parent = entry.parentId, filePath: string | undefined;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const ancestor = byId.get(parent); if (!ancestor) break;
      if (selected.has(parent) && ancestor.message?.role === 'assistant' && Array.isArray(ancestor.message.content)) {
        const call = ancestor.message.content.find((value: { type?: string; id?: string; name?: string; arguments?: { path?: unknown } }) => value?.type === 'toolCall' && value.name === 'edit' && typeof message.toolCallId === 'string' && value.id === message.toolCallId);
        if (call && typeof call.arguments?.path === 'string') { filePath = call.arguments.path; break; }
      }
      parent = ancestor.parentId;
    }
    const groupKey = filePath === undefined ? `entry:${entry.id}` : `path:${roots.length ? paths.resolve(roots[0], filePath) : filePath}`;
    let group = groups.get(groupKey);
    if (!group) { group = { id: entry.id, path: filePath ?? '未记录文件路径', edits: [] }; groups.set(groupKey, group); }
    const line = message.details.firstChangedLine;
    group.edits.push({ entryId: entry.id, patch: message.details.diff, firstChangedLine: typeof line === 'number' && Number.isSafeInteger(line) && line > 0 ? line : null });
  }
  if (selection) {
    const file = [...groups.values()].find(file => file.id === selection.fileId);
    if (!file) throw new DomainError('NOT_FOUND', '本轮没有该文件的原生编辑差异', 404, true);
    return { runId: round!.runId, fileId: file.id, edits: file.edits };
  }
  const relativePath = (value: string) => {
    if (!roots.length || value === '未记录文件路径') return { path: value, projectPath: null };
    const absolute = paths.resolve(roots[0], value);
    const root = [...roots].sort((a, b) => b.length - a.length).find(root => {
      const relative = paths.relative(root, absolute);
      return relative !== '..' && !relative.startsWith('..' + paths.sep) && !paths.isAbsolute(relative);
    });
    return { path: (paths.relative(root ?? roots[0], absolute) || '.').split(paths.sep).join('/'), projectPath: root ?? null };
  };
  return { runId: round!.runId, status: round!.running ? 'running' : 'recorded', notice: null, files: [...groups.values()].map(({ id, path, edits }) => ({ id, ...relativePath(path), editCount: edits.length })) };
}
