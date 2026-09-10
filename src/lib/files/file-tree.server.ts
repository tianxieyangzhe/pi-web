import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getProject } from "@/lib/workspace/workspace-data.server";

export type GitFileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";

export type FileTreeEntry = {
  path: string;
  parentPath: string;
  name: string;
  type: "file" | "directory";
  depth: number;
  gitStatus?: GitFileStatus;
};

const alwaysIgnoredDirectories = new Set(["node_modules"]);
const maxEntries = 500;
const maxDepth = 7;
const maxPreviewBytes = 512 * 1024;

function assertPathInWorkspace(workingDirectory: string, relativePath: string) {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error("文件路径无效");
  const root = fs.realpathSync(workingDirectory);
  const requested = path.resolve(root, relativePath);
  if (requested !== root && !requested.startsWith(`${root}${path.sep}`)) throw new Error("文件路径超出项目目录");
  const actual = fs.realpathSync(requested);
  if (actual !== root && !actual.startsWith(`${root}${path.sep}`)) throw new Error("符号链接指向项目目录之外");
  return actual;
}

function getGitStatuses(workingDirectory: string) {
  const statuses = new Map<string, GitFileStatus>();
  try {
    const output = execFileSync("git", ["-C", workingDirectory, "status", "--porcelain=v1", "-z", "--untracked-files=all"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const records = output.split("\0");
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (!record || record.length < 4) continue;
      const code = record.slice(0, 2);
      const filePath = record.slice(3);
      let status: GitFileStatus | undefined;
      if (code === "??") status = "untracked";
      else if (code.includes("U")) status = "conflicted";
      else if (code.includes("R") || code.includes("C")) status = "renamed";
      else if (code.includes("A")) status = "added";
      else if (code.includes("D")) status = "deleted";
      else if (code.includes("M") || code.includes("T")) status = "modified";
      if (status) statuses.set(filePath, status);
      if (code.includes("R") || code.includes("C")) index += 1;
    }
  } catch {
    // A non-git directory has no status overlay.
  }
  return statuses;
}

function getProjectRoot(workspaceId: string, projectId: string) {
  const project = getProject(projectId);
  if (!project || project.workspaceId !== workspaceId) throw new Error("项目不存在");
  if (project.locationKind !== "local_path" || !project.localPath) throw new Error("该项目没有本地文件目录");
  if (!fs.existsSync(project.localPath)) throw new Error("项目本地路径不存在");
  return fs.realpathSync(project.localPath);
}

export function listProjectFiles(workspaceId: string, projectId: string, includeHidden = false) {
  const root = getProjectRoot(workspaceId, projectId);
  const gitStatuses = getGitStatuses(root);
  const entries: FileTreeEntry[] = [];

  function visit(directory: string, depth: number) {
    if (depth > maxDepth || entries.length >= maxEntries) return;
    const children = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => !entry.isSymbolicLink() && !alwaysIgnoredDirectories.has(entry.name) && (includeHidden || !entry.name.startsWith(".")))
      .sort((left, right) => Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name, "en", { numeric: true, sensitivity: "base" }));

    for (const child of children) {
      if (entries.length >= maxEntries) return;
      const absolutePath = path.join(directory, child.name);
      const relativePath = path.relative(root, absolutePath);
      const parentPath = depth === 0 ? "" : path.dirname(relativePath);
      entries.push({ path: relativePath, parentPath, name: child.name, type: child.isDirectory() ? "directory" : "file", depth, gitStatus: gitStatuses.get(relativePath) });
    }

    for (const child of children) {
      if (entries.length >= maxEntries) return;
      if (child.isDirectory()) visit(path.join(directory, child.name), depth + 1);
    }
  }

  visit(root, 0);
  return { workingDirectory: root, isGitRepository: gitStatuses.size > 0 || fs.existsSync(path.join(root, ".git")), entries, truncated: entries.length >= maxEntries };
}

export function readProjectFile(workspaceId: string, projectId: string, relativePath: string) {
  const absolutePath = assertPathInWorkspace(getProjectRoot(workspaceId, projectId), relativePath);
  const stats = fs.statSync(absolutePath);
  if (!stats.isFile()) throw new Error("只能读取文件内容");
  if (stats.size > maxPreviewBytes) throw new Error("文件超过 512 KB，不能在预览中打开");
  const buffer = fs.readFileSync(absolutePath);
  if (buffer.includes(0)) throw new Error("二进制文件不能在预览中打开");
  return { path: relativePath, content: buffer.toString("utf8"), size: stats.size };
}
