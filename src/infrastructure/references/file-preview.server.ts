import path from 'node:path';
import { unzipSync } from 'fflate';
import { DOMParser } from 'linkedom';
import type { FileBlock, FilePreview } from '@/domain/file-preview';

// XML content is read as data. No HTML, relationships or external resources are rendered.
type XmlNode = { nodeType: number; localName?: string; nodeName: string; textContent: string | null; childNodes: ArrayLike<XmlNode>; getAttribute(name: string): string | null; getElementsByTagName(tag: string): ArrayLike<XmlNode> };
const elements = (node: XmlNode, tag: string) => Array.from(node.getElementsByTagName(tag));
const local = (node: XmlNode) => node.nodeName.split(':').pop();
const children = (node: XmlNode) => Array.from(node.childNodes).filter(child => child.nodeType === 1);
function text(node: XmlNode): string {
  if (local(node) === 't') return node.textContent ?? '';
  if (local(node) === 'tab') return '\t';
  if (['br', 'cr'].includes(local(node) ?? '')) return '\n';
  return children(node).map(text).join('');
}
function officeFiles(bytes: Buffer, accept: (name: string) => boolean) {
  let count = 0, expanded = 0;
  return unzipSync(bytes, { filter(entry) {
    expanded += entry.originalSize;
    if (++count > 10000 || !Number.isSafeInteger(expanded) || expanded > 50_000_000) throw Error('文档展开内容超过预览上限');
    return accept(entry.name);
  } });
}
function parse(data: Uint8Array | undefined): XmlNode {
  if (!data) throw Error('缺少文档内容');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(data);
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw Error('不支持包含实体定义的文档');
  return new DOMParser().parseFromString(source, 'text/xml') as unknown as XmlNode;
}
function descendants(node: XmlNode, name: string): XmlNode[] {
  const result: XmlNode[] = [];
  function visit(parent: XmlNode) { for (const child of children(parent)) { if (local(child) === name) result.push(child);visit(child); } }
  visit(node);
  return result;
}
function relationships(files: Record<string, Uint8Array>, owner: string) {
  const relPath = path.posix.join(path.posix.dirname(owner), '_rels', path.posix.basename(owner) + '.rels');
  const result = new Map<string, string>();
  for (const rel of descendants(parse(files[relPath]), 'Relationship')) {
    if (rel.getAttribute('TargetMode') === 'External') continue;
    const target = rel.getAttribute('Target') ?? '';
    if (!target || target.includes('\\') || /[\u0000-\u001f]/.test(target)) throw Error('文档关系无效');
    const normalized = path.posix.normalize(target.startsWith('/') ? target.slice(1) : path.posix.join(path.posix.dirname(owner), target));
    if (normalized.startsWith('../')) throw Error('文档内容关系无效');
    result.set(rel.getAttribute('Id') ?? '', normalized);
  }
  return result;
}
function docx(bytes: Buffer): FileBlock[] {
  const files = officeFiles(bytes, name => name === 'word/document.xml' || name === 'word/styles.xml');
  if (!files['word/document.xml']) throw Error('缺少Word正文');
  const styles = new Map<string, { name: string; level?: number }>();
  if (files['word/styles.xml']) for (const style of elements(parse(files['word/styles.xml']), 'w:style')) {
    const outline = elements(style, 'w:outlineLvl')[0]?.getAttribute('w:val');
    styles.set(style.getAttribute('w:styleId') ?? '', { name: elements(style, 'w:name')[0]?.getAttribute('w:val') ?? '', ...(outline !== undefined && outline !== null ? { level: Number(outline) + 1 } : {}) });
  }
  const body = elements(parse(files['word/document.xml']), 'w:body')[0];
  if (!body) throw Error('Word正文无效');
  const blocks: FileBlock[] = [];
  function visit(node: XmlNode) {
    if (local(node) === 'tbl') {
      const rows = children(node).filter(n => local(n) === 'tr').map(row => children(row).filter(n => local(n) === 'tc').map(cell => elements(cell, 'w:p').map(text).join('\n')));
      blocks.push({ type: 'table', rows }); return;
    }
    if (local(node) === 'p') {
      const value = text(node), id = elements(node, 'w:pStyle')[0]?.getAttribute('w:val') ?? '', style = styles.get(id);
      const outline = elements(node, 'w:outlineLvl')[0]?.getAttribute('w:val');
      const namedLevel = (id + ' ' + (style?.name ?? '')).match(/(?:heading|标题)\s*([1-6])/i)?.[1];
      const level = outline != null ? Number(outline) + 1 : style?.level ?? Number(namedLevel);
      if (level >= 1 && level <= 6) blocks.push({ type: 'heading', level, text: value });
      else if (/code|代码|source|preformatted/i.test(id + ' ' + (style?.name ?? '')) || elements(node, 'w:rFonts').some(font => /consolas|courier|mono/i.test(font.getAttribute('w:ascii') ?? ''))) blocks.push({ type: 'code', text: value });
      else blocks.push({ type: 'paragraph', text: value });
      return;
    }
    children(node).forEach(visit);
  }
  children(body).forEach(visit);
  return blocks;
}
function xmlAttribute(value: string) {
  const entities: Record<string,string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    if (!entity.startsWith('#')) return entities[entity] ?? match;
    const point = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2),16) : Number(entity.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : match;
  });
}
function xlsx(bytes: Buffer): FileBlock[] {
  const files = officeFiles(bytes, name => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name));
  const strings = files['xl/sharedStrings.xml'] ? descendants(parse(files['xl/sharedStrings.xml']), 'si').map(node => descendants(node, 't').map(n => n.textContent ?? '').join('')) : [];
  const relations = relationships(files, 'xl/workbook.xml');
  const blocks: FileBlock[] = [];
  let projected = 0;
  for (const sheet of descendants(parse(files['xl/workbook.xml']), 'sheet')) {
    const target = relations.get(sheet.getAttribute('r:id') ?? '');
    if (!target || !target.startsWith('xl/worksheets/')) throw Error('工作表关系无效');
    blocks.push({ type: 'heading', level: 2, text: xmlAttribute(sheet.getAttribute('name') ?? '工作表') });
    const rows: string[][] = [];
    for (const row of descendants(parse(files[target]), 'row')) {
      const cells = children(row).filter(node => local(node) === 'c');
      const values: string[] = [];
      let next = 0;
      for (const cell of cells) {
        const ref = cell.getAttribute('r') ?? '';
        const letters = ref.match(/^([A-Z]+)[1-9]\d*$/)?.[1];
        let column = 0;
        if (letters) for (const letter of letters) column = column * 26 + letter.charCodeAt(0) - 64;
        const index = letters ? column - 1 : next;
        if (index >= 512 || index < next) throw Error('工作表列数或顺序超过预览范围');
        next = index + 1;
        const kind = cell.getAttribute('t');
        const cached = descendants(cell, 'v')[0]?.textContent;
        const formula = descendants(cell, 'f')[0]?.textContent;
        const value = kind === 's' ? strings[Number(cached)] ?? '' : kind === 'inlineStr' ? descendants(cell, 't').map(n => n.textContent ?? '').join('') : kind === 'b' ? cached === '1' ? 'TRUE' : 'FALSE' : cached ?? (formula != null ? '=' + formula : '');
        values[index] = value;
      }
      if (!values.length) continue;
      projected += values.length + 1;
      if (projected > 100000 || rows.length >= 10000) throw Error('工作表单元格超过预览上限');
      const rowNumber = row.getAttribute('r') ?? cells[0]?.getAttribute('r')?.match(/\d+$/)?.[0] ?? String(rows.length + 1);
      rows.push([rowNumber, ...Array.from({ length: values.length }, (_, i) => values[i] ?? '')]);
    }
    const width = Math.max(0, ...rows.map(row => row.length - 1));
    const rectangular = (rows.length + 1) * (width + 1);
    projected += rectangular - rows.reduce((sum, row) => sum + row.length, 0);
    if (projected > 100000) throw Error('工作表单元格超过预览上限');
    const columnName = (n: number) => { let value = ''; for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) value = String.fromCharCode(65 + (i - 1) % 26) + value; return value; };
    blocks.push({ type: 'table', rows: [['行 / 列', ...Array.from({ length: width }, (_, i) => columnName(i))], ...rows.map(row => [...row, ...Array(width + 1 - row.length).fill('')])] });
  }
  if (!blocks.length) throw Error('没有工作表');
  return blocks;
}
function pptx(bytes: Buffer): FileBlock[] {
  const files = officeFiles(bytes, name => /^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/[^/]+\.xml)$/.test(name));
  const relations = relationships(files, 'ppt/presentation.xml');
  const blocks: FileBlock[] = [];
  let page = 0, cells = 0;
  for (const slide of descendants(parse(files['ppt/presentation.xml']), 'sldId')) {
    const target = relations.get(slide.getAttribute('r:id') ?? '');
    if (!target || !target.startsWith('ppt/slides/')) throw Error('幻灯片关系无效');
    blocks.push({ type: 'heading', level: 2, text: `幻灯片 ${++page}` });
    const document = parse(files[target]);
    function visit(node: XmlNode) {
      if (local(node) === 'tbl') {
        const rows = children(node).filter(n => local(n) === 'tr').map(row => children(row).filter(n => local(n) === 'tc').map(cell => descendants(cell, 'p').map(text).join('\n')));
        cells += rows.reduce((sum, row) => sum + row.length, 0);
        if (cells > 100000 || rows.length > 10000 || rows.some(row => row.length > 512)) throw Error('幻灯片表格超过预览上限');
        blocks.push({ type: 'table', rows }); return;
      }
      if (local(node) === 'p') { const value = text(node);if (value) blocks.push({ type: 'paragraph', text: value });return; }
      children(node).forEach(visit);
    }
    visit(document);
  }
  if (!page) throw Error('没有幻灯片');
  return blocks;
}
export function previewFile(relative: string, bytes: Buffer): FilePreview {
  const base = { path: relative, content: '', size: bytes.length };
  const extension = path.extname(relative).toLowerCase();
  if (extension === '.pdf') return bytes.subarray(0, 1024).toString('latin1').includes('%PDF-')
    ? { ...base, format: 'pdf', notice: 'PDF原件预览；如浏览器不支持内嵌PDF，请下载原件查看。' }
    : { ...base, format: 'binary', notice: '文件缺少有效PDF签名，无法预览，可下载原件检查。' };
  if (extension === '.xlsx' || extension === '.pptx') {
    try { return { ...base, format: extension === '.xlsx' ? 'xlsx' : 'pptx', blocks: extension === '.xlsx' ? xlsx(bytes) : pptx(bytes), notice: extension === '.xlsx' ? 'Excel内容预览；公式使用已保存缓存值，不重算，日期显示存储值，图表和格式请下载查看。' : 'PPT内容预览；显示幻灯片文字及表格，图片、主题、动画和布局请下载查看。' }; }
    catch { return { ...base, format: 'binary', notice: '文档无法预览（可能损坏、加密或超过预览范围），可下载原件。' }; }
  }
  if (extension === '.xls' || extension === '.ppt') return { ...base, format: 'binary', notice: '旧版Office二进制格式暂不支持预览，请下载查看或转换为.xlsx/.pptx。' };
  if (extension === '.docx') {
    try { return { ...base, format: 'docx', blocks: docx(bytes), notice: 'Word内容预览；分页、字体、图片和公式版式请下载原件查看。' }; }
    catch { return { ...base, format: 'binary', notice: 'Word文档无法预览（可能损坏、加密或超过展开上限），可下载原件。' }; }
  }
  if (bytes.length > 512 * 1024) return { ...base, format: 'binary', notice: '文件超过512KiB文本预览上限，可下载原件。' };
  try {
    if (bytes.includes(0)) throw Error();
    return { ...base, content: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch { return { ...base, format: 'binary', notice: '此格式暂不支持内容预览，可下载原件。' }; }
}
