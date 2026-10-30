import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DomainError } from "@/domain/errors";
import { pathsOverlap } from "@/application/bots/project-path-boundary";
const blockedName = /^(?:\.env(?:\.|$)|\.git$|\.ssh$|\.aws$|\.codex$|\.npmrc$|\.pypirc$|id_(?:rsa|dsa|ecdsa|ed25519)|credentials?\.|\.next$|\.turbo$|coverage$|dist$|build$|node_modules$)/i;
function checked(root: string, relative: string, projectRoots: string[] = []) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(x => x === '..' || blockedName.test(x))) throw new DomainError('SENSITIVE_PATH', '文件路径不允许访问', 422, true);
  let base: string, target: string;
  try { base = fs.realpathSync(root); target = fs.realpathSync(path.resolve(base, relative)); }
  catch { throw new DomainError("REFERENCE_READ_FAILED", "工作目录或文件不可用", 409, true); }
  for(const projectRoot of projectRoots){
    let canonicalProjectRoot:string;
    try{canonicalProjectRoot=fs.realpathSync(projectRoot);}catch{throw new DomainError('BOT_WORKSPACE_PROJECT_OVERLAP','无法核验 Bot 工作目录与 Project 边界，已拒绝直接访问。请通过项目 Session 派发项目工作。',403,true);}
    if(pathsOverlap(base,canonicalProjectRoot))throw new DomainError('BOT_WORKSPACE_PROJECT_OVERLAP','Bot 工作目录与当前协作 Project 根目录重叠，不能从协调会话直接访问项目内容。请通过项目 Session 派发项目工作。',403,true);
  }
  if (path.relative(base,target).split(path.sep).some(x=>blockedName.test(x)))throw new DomainError('SENSITIVE_PATH','敏感文件不能预览',422,true);
  if (target !== base && !target.startsWith(base + path.sep)) throw new DomainError('PATH_OUTSIDE_PROJECT', '文件超出 Bot 工作目录', 422, true);
  return target;
}
export function readBotReference(root: string, relative: string): {name: string; data: string} {
  if (!relative) throw new DomainError('INVALID_PATH', '文件路径无效', 400, true);
  let fd: number | undefined;
  try {
    const absolute = checked(root, relative);
    fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const before = fs.fstatSync(fd);
    const checkedAgain = checked(root, relative);
    const current = fs.statSync(checkedAgain);
    if (checkedAgain !== absolute || before.dev !== current.dev || before.ino !== current.ino) throw new DomainError('FILE_CHANGED', '参考文件路径发生变化，请重试', 409, true);
    if (!before.isFile()) throw new DomainError('INVALID_FILE', '只能选择普通文件', 400, true);
    if (before.size > 2 * 1024 * 1024) throw new DomainError('FILE_TOO_LARGE', '参考文件超过容量限制', 413, true);
    const buffer = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < buffer.length) { const n = fs.readSync(fd, buffer, offset, buffer.length - offset, offset); if (!n) break; offset += n; }
    const after = fs.fstatSync(fd);
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new DomainError('FILE_CHANGED', '参考文件发生变化，请重试', 409, true);
    return {name: path.basename(absolute), data: buffer.toString('base64')};
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError('REFERENCE_READ_FAILED', '无法读取参考文件，请检查后重试', 409, true);
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
export const botFiles = {
  resolveReference(root: string, relative: string, projectRoots: string[] = []) {
    if (!relative) throw new DomainError("INVALID_PATH", "文件路径无效", 400, true);
    const absolute = checked(root, relative, projectRoots);
    return { absolute, identity: `bot:${absolute}` };
  },
  list(root: string, relative: string, projectRoots: string[] = []) {
    const target = checked(root, relative,projectRoots);
    try {
      if (!fs.statSync(target).isDirectory()) throw new DomainError('INVALID_PATH', '所选路径不是目录', 400, true);
      const children = fs.readdirSync(target, { withFileTypes: true }).filter(x => !x.isSymbolicLink()&&!blockedName.test(x.name));
      const entries = children.slice(0, 1000).map(x => ({
        name: x.name,
        path: path.posix.join(relative, x.name),
        parentPath: relative,
        type: x.isDirectory() ? 'directory' as const : 'file' as const
      }));
      return { entries, isGitRepository: false, truncated: children.length > 1000 };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError('REFERENCE_READ_FAILED', '无法读取工作目录，请检查目录和访问权限', 409, true);
    }
  },
  read(root: string, relative: string, projectRoots: string[] = []) {
    const target = checked(root, relative,projectRoots),
      info = fs.statSync(target);
    if (!info.isFile() || info.size > 262144) throw new DomainError('INVALID_FILE', '文件不是普通文件或超过预览上限', 422, true);
    const buffer = fs.readFileSync(target);
    if (buffer.includes(0)) throw new DomainError('INVALID_FILE', '二进制文件无法预览', 422, true);
    return {
      path: relative,
      content: buffer.toString('utf8'),
      size: info.size
    };
  }
};
