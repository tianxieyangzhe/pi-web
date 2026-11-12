import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DomainError } from '@/domain/errors';
import type { SessionContextFile, SessionContextFilesStore } from '@/application/ports/session-context-files';
import { applicationConfigRoot } from '@/infrastructure/application-config-root';
import { documentText } from './document-text.server';

type Item = SessionContextFile & { contentSha256: string; content: string };
type Manifest = { version: 1; sessionId: string; items: Item[] };
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const unreadable = () => new DomainError('CONTEXT_FILE_UNREADABLE', '参考项目文件需要完整可读正文，请使用 UTF-8 文本或可提取正文的 Office 文档；图片和其他材料可继续通过上传或粘贴发送。', 422, true);
const fail = () => new DomainError('CONTEXT_FILES_UNAVAILABLE', '无法读取或保存会话参考文件，请检查存储后重试', 503, true);

export function createSessionContextFilesStore(root: string): SessionContextFilesStore & {
  documents(sessionId: string): Array<{ path: string; content: string }>;
} {
  const target = (id: string) => path.join(root, `${hash(id)}.json`);
  const etag = (value: Manifest) => `"${hash(JSON.stringify(value))}"`;
  function load(id: string): Manifest {
    try {
      if (!fs.existsSync(root)) return { version: 1, sessionId: id, items: [] };
      if (fs.lstatSync(root).isSymbolicLink() || !fs.lstatSync(root).isDirectory()) throw fail();
      const file = target(id);
      if (!fs.existsSync(file)) return { version: 1, sessionId: id, items: [] };
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 8_000_000) throw fail();
      const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest;
      if (value.version !== 1 || value.sessionId !== id || !Array.isArray(value.items) || value.items.length > 10) throw fail();
      const ids = new Set<string>();
      for (const item of value.items) {
        if (typeof item.id !== 'string' || ids.has(item.id) || typeof item.name !== 'string' || item.source !== 'project' || item.kind !== 'document' || typeof item.projectId !== 'string' || typeof item.path !== 'string' || typeof item.content !== 'string' || hash(item.content) !== item.contentSha256) throw fail();
        ids.add(item.id);
      }
      return value;
    } catch (error) { if (error instanceof DomainError) throw error; throw fail(); }
  }
  function view(value: Manifest) {
    return { files: value.items.map(({ content: _content, contentSha256: _hash, ...item }) => item), writeETag: etag(value) };
  }
  function checked(id: string, expected: string) {
    if (!expected) throw new DomainError('PRECONDITION_REQUIRED', '缺少 If-Match，请先读取参考文件列表', 428, true);
    const value = load(id);
    if (etag(value) !== expected) throw new DomainError('WRITE_CONFLICT', '参考文件已变化，请刷新列表后重试', 409, true);
    return value;
  }
  function save(value: Manifest) {
    const textBytes = value.items.reduce((n, item) => n + Buffer.byteLength(item.content), 0);
    if (value.items.length > 10 || textBytes > 1_048_576) throw new DomainError('CONTEXT_FILES_TOO_LARGE', '参考项目文件最多 10 个，正文合计不超过 1MiB；不会截断正文', 413, true);
    let temporary: string | undefined;
    try {
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      if (fs.lstatSync(root).isSymbolicLink()) throw fail();
      temporary = path.join(root, `.${randomUUID()}.tmp`);
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, target(value.sessionId)); temporary = undefined;
      const directory = fs.openSync(root, 'r');
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
      return view(value);
    } catch (error) { if (error instanceof DomainError) throw error; throw fail(); }
    finally { if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  return {
    read: id => view(load(id)),
    add(id, references, expected, resolve) {
      const value = checked(id, expected);
      if (!Array.isArray(references) || !references.length || references.length > 10) throw new DomainError('INVALID_REFERENCES', '请选择 1 至 10 个参考项目文件', 400, true);
      const additions = references.map(reference => {
        if (!reference || typeof reference !== 'object' || Object.keys(reference).some(key => !['projectId', 'path'].includes(key)) || typeof reference.projectId !== 'string' || !reference.projectId || typeof reference.path !== 'string' || !reference.path) throw new DomainError('INVALID_REFERENCES', '仅接受项目文件引用；上传和粘贴继续随消息发送', 400, true);
        const file = resolve(reference), extracted = documentText(file.name, file.bytes);
        let content = extracted.text;
        if (content === undefined) {
          if (/\.(pdf|doc|xls|ppt|docx|xlsx|pptx|odt|ods|odp)$/i.test(file.name) || file.bytes.includes(0)) throw unreadable();
          try { content = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes); } catch { throw unreadable(); }
        }
        if (!content.trim()) throw unreadable();
        return { source: 'project' as const, projectId: reference.projectId, path: reference.path, id: hash(JSON.stringify([reference.projectId, reference.path, hash(file.bytes)])), name: file.name, kind: 'document' as const, content, contentSha256: hash(content) };
      });
      const items = [...value.items];
      for (const item of additions) if (!items.some(existing => existing.id === item.id)) items.push(item);
      return save({ ...value, items });
    },
    remove(id, fileId, expected) {
      const value = checked(id, expected);
      if (!value.items.some(item => item.id === fileId)) throw new DomainError('NOT_FOUND', '参考文件不存在', 404, true);
      return save({ ...value, items: value.items.filter(item => item.id !== fileId) });
    },
    documents: id => load(id).items.map(item => ({ path: `${item.projectId}/${item.path}`, content: item.content })),
  };
}
export const sessionContextFiles = createSessionContextFilesStore(path.join(applicationConfigRoot, '.data', 'session-context-files'));
