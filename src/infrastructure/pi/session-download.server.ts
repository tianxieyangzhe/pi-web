import { createReadStream, closeSync, fsyncSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {DomainError} from '@/domain/errors';
import { createHash } from 'node:crypto';
export function sessionDownload(content:string,id:string,format:'html'|'jsonl',scope:'tree'|'branch',signal?:AbortSignal) {
  const folder=mkdtempSync(path.join(tmpdir(),'pi-session-export-')),file=path.join(folder,'download');
  try {
    const bytes=Buffer.from(content,'utf8'),fd=openSync(file,'wx',0o600);
    try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
    const stream=createReadStream(file);
    const abort=()=>stream.destroy();signal?.addEventListener('abort',abort,{once:true});
    stream.once('close',()=>{signal?.removeEventListener('abort',abort);rmSync(folder,{recursive:true,force:true});});
    if(signal?.aborted)stream.destroy();
    const safeId=/^[\w-]{1,128}$/.test(id)?id:createHash('sha256').update(id).digest('hex');
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>,{headers:{'cache-control':'no-store','content-type':format==='html'?'text/html; charset=utf-8':'application/x-ndjson; charset=utf-8','content-length':String(bytes.length),'content-disposition':`attachment; filename="${safeId}-${scope}.${format}"`,'x-content-type-options':'nosniff'}});
  }catch{rmSync(folder,{recursive:true,force:true});throw new DomainError('SESSION_EXPORT_FAILED','无法准备完整下载文件',500,true);}
}
