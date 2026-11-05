import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SessionManager, type SessionEntry } from '@earendil-works/pi-coding-agent';
import { DomainError } from '@/domain/errors';
import { readNativeFile } from './session-tree.server';

export function syncDirectory(directory: string) { const fd = openSync(directory, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
export const fileDigest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
export function persistManager(manager: SessionManager, expected?: string) {
  const file = manager.getSessionFile(), header = manager.getHeader();
  if (!file || !header) throw new DomainError('NO_NATIVE_REF', '原生会话没有持久身份', 409, true);
  if (expected !== undefined && fileDigest(file) !== expected) throw new DomainError('REQUEST_UNKNOWN', '原生文件已发生外部变化，请核对', 409, true);
  const complete = [header, ...manager.getEntries()];
  let prefix = '';
  try { prefix = readFileSync(file, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const existing = prefix ? prefix.trimEnd().split('\n').map(line => JSON.parse(line)) : [];
  if (prefix && !prefix.endsWith('\n') || existing.length > complete.length || existing.some((entry,index) => JSON.stringify(entry) !== JSON.stringify(complete[index]))) throw new DomainError('REQUEST_UNKNOWN', '内存树与原生文件不一致，不能覆盖历史', 409, true);
  const bytes = prefix + complete.slice(existing.length).map(entry => JSON.stringify(entry)).join('\n') + (existing.length < complete.length ? '\n' : '');
  const temporary = file + '.' + randomUUID() + '.tmp';
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  try {if(prefix?fileDigest(file)!==createHash('sha256').update(prefix).digest('hex'):existsSync(file))throw new DomainError('REQUEST_UNKNOWN','原生文件在写入期间变化，未覆盖历史',409,true);renameSync(temporary, file); syncDirectory(path.dirname(file)); } catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
  // Synchronize Pi's public persistence state after a metadata-only first flush.
  // Otherwise its next append tries exclusive creation of the file we just published.
  const leaf = manager.getLeafId();
  manager.setSessionFile(file);
  if (manager.getLeafId() !== leaf) { if (leaf) manager.branch(leaf); else manager.resetLeaf(); }
  return fileDigest(file);
}
export function branchEntries(entries: SessionEntry[], leaf: string | null) {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const result: SessionEntry[] = [], seen = new Set<string>();
  while (leaf) {
    const entry = byId.get(leaf);
    if (!entry || seen.has(leaf)) throw new DomainError('SESSION_TREE_READ_FAILED', '原生节点链不完整', 500, true);
    result.push(entry); seen.add(leaf); leaf = entry.parentId;
  }
  return result.reverse();
}
export function prepareFork(source: { header: object; entries: SessionEntry[]; sessionFile: string; cwd: string }, entryId: string, directory: string) {
  const entries = branchEntries(source.entries, entryId), ids = new Set(entries.map(entry => entry.id));
  const supported = new Set(['message','model_change','thinking_level_change','compaction','branch_summary','custom','custom_message','label','session_info','usage','context_edit']);
  if (entries.some(entry => !supported.has(entry.type) || entry.type === 'compaction' && !ids.has(entry.firstKeptEntryId) || (entry.type === 'label'||entry.type === 'context_edit') && !ids.has(entry.targetId) || entry.type==='branch_summary'&&!ids.has(entry.fromId))) {
    throw new DomainError('FORK_NODE_UNSUPPORTED', '所选路径含无法独立恢复的节点引用', 422, true);
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  syncDirectory(path.dirname(directory));
  const inputFile = path.join(directory, 'source-snapshot.jsonl');
  writeFileSync(inputFile, [source.header, ...source.entries].map(value => JSON.stringify(value)).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  try {
    const manager = SessionManager.open(inputFile, directory, source.cwd);
    manager.createBranchedSession(entryId);
    const file = manager.getSessionFile(), header = manager.getHeader();
    if (!file || file === inputFile || !header) throw new DomainError('FORK_NODE_UNSUPPORTED', 'Pi 无法创建独立候选身份', 422, true);
    const fd = openSync(file, 'w', 0o600);
    try { writeFileSync(fd, [{ ...header, parentSession: source.sessionFile }, ...entries].map(value => JSON.stringify(value)).join('\n') + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
    syncDirectory(directory);
    const verified = readNativeFile(file, source.cwd, header.id);
    const reopened = SessionManager.open(file, directory, source.cwd);
    if (JSON.stringify(verified.entries.slice(1)) !== JSON.stringify(entries) || reopened.getLeafId() !== entryId || JSON.stringify(reopened.getBranch()) !== JSON.stringify(entries)) throw new DomainError('FORK_NODE_UNSUPPORTED', 'Pi 无法保真恢复所选路径', 422, true);
    return { kind: 'pi', sessionFile: file, sessionId: header.id, cwd: source.cwd };
  } finally { unlinkSync(inputFile); }
}
const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
function staticMarkdown(text:string){
  const output:string[]=[];let fence=false,code:string[]=[];
  for(const line of text.split(/\r?\n/)){
    if(/^\s*```/.test(line)){if(fence){output.push('<pre><code>'+escapeHtml(code.join('\n'))+'</code></pre>');code=[];}fence=!fence;continue;}
    if(fence){code.push(line);continue;}
    const heading=line.match(/^(#{1,6})\s+(.*)$/),quote=line.match(/^>\s?(.*)$/),item=line.match(/^\s*(?:[-*+] |\d+\. )(.*)$/);
    if(heading){const level=heading[1].length;output.push('<h'+level+'>'+escapeHtml(heading[2])+'</h'+level+'>');}
    else if(quote)output.push('<blockquote>'+escapeHtml(quote[1])+'</blockquote>');
    else if(item)output.push('<ul><li>'+escapeHtml(item[1])+'</li></ul>');
    else output.push(line?'<p>'+escapeHtml(line)+'</p>':'<br>');
  }
  if(code.length)output.push('<pre><code>'+escapeHtml(code.join('\n'))+'</code></pre>');
  return output.join('');
}
export function renderSessionExport(header: object, entries: SessionEntry[], format: 'html' | 'jsonl', title: string) {
  if (format === 'jsonl') return [header, ...entries].map(value => JSON.stringify(value)).join('\n') + '\n';
  const raw = (value: object) => escapeHtml(JSON.stringify(value, null, 2));
  const readable=(entry:SessionEntry)=>{
    if(entry.type==='message'){
      const message=entry.message as {role?:string;content?:unknown};
      const content=typeof message.content==='string'?[{type:'text',text:message.content}]:Array.isArray(message.content)?message.content:[];
      return '<h3>'+escapeHtml(message.role??entry.type)+'</h3>'+content.map((part:{type?:string;text?:string;thinking?:string})=>part.type==='text'?staticMarkdown(part.text??''):part.type==='thinking'?'<details><summary>Thinking</summary><pre>'+escapeHtml(part.thinking??'')+'</pre></details>':'').join('');
    }
    if(entry.type==='compaction'||entry.type==='branch_summary')return staticMarkdown(entry.summary);
    if(entry.type==='custom_message'&&typeof entry.content==='string')return staticMarkdown(entry.content);
    return '';
  };
  return '<!doctype html><html lang="zh"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>' + escapeHtml(title) + '</title><style>body{font:15px system-ui;margin:2rem;max-width:100rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{border-bottom:1px solid #ddd;padding:1rem}summary{cursor:pointer}</style><body><h1>' + escapeHtml(title) + '</h1><details><summary>Session header</summary><pre>' + raw(header) + '</pre></details>' + entries.map(entry => '<article id="entry-'+escapeHtml(entry.id)+'">'+readable(entry)+'<details><summary>' + escapeHtml(entry.type + ' · ' + entry.id) + ' · 完整原生节点</summary><pre>' + raw(entry) + '</pre></details></article>').join('') + '</body></html>';
}
