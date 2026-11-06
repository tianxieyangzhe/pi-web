import path from 'node:path';
import type { FileDownload } from '@/domain/file-preview';

export function fileDownloadResponse(file: FileDownload) {
  const types: Record<string, string> = {
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.zip': 'application/zip',
  };
  const name = path.basename(file.name).replace(/[\u0000-\u001f\u007f]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
  return new Response(new Uint8Array(file.bytes), { headers: {
    'content-type': types[path.extname(name).toLowerCase()] ?? 'application/octet-stream',
    'content-length': String(file.bytes.byteLength),
    'content-disposition': `attachment; filename="download${path.extname(name).replace(/[^.a-z0-9]/gi, '')}"; filename*=UTF-8''${encoded}`,
    'cache-control': 'no-store, no-transform', 'x-content-type-options': 'nosniff',
  } });
}
