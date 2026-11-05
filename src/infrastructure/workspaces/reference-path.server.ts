import fs from "node:fs/promises";
import path from "node:path";
import type { WorkspaceProject } from "@/domain/workspace";
import { DomainError } from "@/domain/errors";
const inside = (root: string, target: string) => target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
export async function workspaceReferenceTarget(projects: WorkspaceProject[], projectId: string, relative: string) {
  const project = projects.find(item => item.id === projectId);
  if (!project) throw new DomainError('PATH_OUTSIDE_WORKSPACE','目标项目不属于本工作区',403,true);
  const root = await fs.realpath(project.rootPath);
  if (root !== path.resolve(project.rootPath)) throw new DomainError('PATH_OUTSIDE_WORKSPACE','项目根目录身份已变化，请检查工作区配置',403,true);
  if (path.isAbsolute(relative)) throw new DomainError('PATH_OUTSIDE_WORKSPACE','请使用项目内相对路径',403,true);
  const target = path.resolve(root,relative || '.');
  if (!inside(root,target)) throw new DomainError('PATH_OUTSIDE_WORKSPACE','路径越出目标项目',403,true);
  const actual = await fs.realpath(target);
  if (!inside(root,actual)) throw new DomainError('PATH_OUTSIDE_WORKSPACE','参考文件符号链接越出项目目录',403,true);
  return {project,target};
}
