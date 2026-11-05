type ProjectPath = {id:string;rootPath:string};
export function isLocalFileLink(href: string) {
  return !!href && !href.startsWith('#') && !href.startsWith('//') && !/^[a-z][a-z\d+.-]*:(?!\d+(?:#|$))/i.test(href);
}
function normalize(path: string) {
  const parts: string[] = [];
  for (const part of path.split('/')) { if (!part || part === '.') continue; if (part === '..') { if (!parts.length) throw new Error('文件路径超出项目目录'); parts.pop(); } else parts.push(part); }
  return '/' + parts.join('/');
}
export function resolveFileLink(href:string,projects:ProjectPath[],defaultProjectId:string) {
  const [raw,fragment] = href.split('#',2);
  let decoded: string;try { decoded=decodeURIComponent(raw); } catch { throw new Error('文件链接编码无效'); }
  if (!decoded || /[\u0000-\u001f]/.test(decoded)) throw new Error('文件链接无效');
  const suffix=decoded.match(/:(\d+)(?::\d+)?$/);
  if(suffix)decoded=decoded.slice(0,suffix.index);
  const lineText=fragment?.match(/^L(\d+)(?:-L?\d+)?$/)?.[1]??suffix?.[1];
  const line=lineText?Number(lineText):undefined;
  const defaultProject=projects.find(project=>project.id===defaultProjectId);
  if(!defaultProject)throw new Error('会话默认项目不可用');
  const absolute=normalize(decoded.startsWith('/')?decoded:defaultProject.rootPath+'/'+decoded);
  const project=[...projects].sort((a,b)=>b.rootPath.length-a.rootPath.length).find(project=>{const root=normalize(project.rootPath);return absolute.startsWith(root==='/'?'/':root+'/');});
  if(!project)throw new Error('文件不属于当前会话的项目范围');
  const root=normalize(project.rootPath);
  return {projectId:project.id,path:absolute.slice(root==='/'?1:root.length+1),line:line !== undefined && Number.isSafeInteger(line) && line > 0 ? line : undefined};
}
