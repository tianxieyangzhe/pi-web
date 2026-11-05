import fs from "node:fs/promises";
import path from "node:path";
import { DomainError } from "@/domain/errors";
import type { WorkspaceDirectories } from "@/application/ports/workspace";
export const workspaceDirectories: WorkspaceDirectories = {
  async normalize(value) {
    if (!path.isAbsolute(value) || value.includes('\0')) throw new DomainError('INVALID_INPUT','请选择绝对目录',400,true);
    try { const root = await fs.realpath(value); if (!(await fs.stat(root)).isDirectory()) throw new Error('not directory'); await fs.access(root,fs.constants.R_OK); return root; }
    catch { throw new DomainError('DIRECTORY_UNAVAILABLE','目录不存在或不可访问',422,true); }
  },
  async list(value) {
    const root = await this.normalize(value || process.cwd());
    const entries = await fs.readdir(root,{withFileTypes:true});
    const directories = [];
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const target = path.join(root,entry.name);
      try { if ((await fs.stat(target)).isDirectory()) directories.push({name:entry.name,path:target}); } catch { /* Broken or inaccessible child; the parent remains browsable. */ }
    }
    if (directories.length > 2000) throw new DomainError('PAYLOAD_TOO_LARGE','子目录过多，请选择更具体的目录',413,true);
    return {path:root,parent:path.dirname(root) === root ? null : path.dirname(root),directories:directories.sort((a,b)=>a.name.localeCompare(b.name))};
  },
};
