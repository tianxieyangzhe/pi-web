import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DomainError } from "@/domain/errors";
import { projectRepository } from "@/infrastructure/database/project-repository.server";
import type { ProjectMessageReference } from "@/domain/message-references";

export type GitFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflicted";

export type ProjectFileEntry = {
  path: string;
  parentPath: string;
  name: string;
  type: "file" | "directory";
  gitStatus?: GitFileStatus;
};

export type ProjectChanges = {
  isGitRepository: boolean;
  status: string;
  workingPatch: string;
  stagedPatch: string;
};

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "build",
  "node_modules",
]);
const sensitiveNames = [
  /^\.env(?:\.|$)/i,
  /^\.(?:ssh|aws|codex)$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^credentials?\./i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)/i,
];
const maxDirectoryEntries = 1000;
const maxPreviewBytes = 512 * 1024;
const maxDiffBytes = 1024 * 1024;

function projectRoot(projectId: string): string {
  const project = projectRepository.get(projectId);
  if (!project) throw new DomainError("NOT_FOUND", "项目不存在", 404, true);
  if (project.status !== "active") {
    throw new DomainError("PROJECT_UNAVAILABLE", "项目当前不可用", 409, true);
  }
  try {
    return fs.realpathSync(project.rootPath);
  } catch {
    throw new DomainError("PROJECT_UNAVAILABLE", "项目路径当前不可用", 409, true);
  }
}

function isSensitive(relativePath: string): boolean {
  return relativePath
    .split(path.sep)
    .some((part) => sensitiveNames.some((pattern) => pattern.test(part)));
}

function safePath(root: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new DomainError("INVALID_PATH", "文件路径无效", 400, true);
  }
  const requested = path.resolve(root, relativePath);
  if (isSensitive(path.relative(root, requested))) throw new DomainError("SENSITIVE_FILE", "敏感文件不能预览", 403);
  if (requested !== root && !requested.startsWith(`${root}${path.sep}`)) {
    throw new DomainError("PATH_OUTSIDE_PROJECT", "文件路径超出项目目录", 403);
  }
  let actual: string;
  try {
    actual = fs.realpathSync(requested);
  } catch {
    throw new DomainError("NOT_FOUND", "文件不存在", 404, true);
  }
  if (actual !== root && !actual.startsWith(`${root}${path.sep}`)) {
    throw new DomainError("PATH_OUTSIDE_PROJECT", "符号链接指向项目目录之外", 403);
  }
  if (isSensitive(path.relative(root, actual))) {
    throw new DomainError("SENSITIVE_FILE", "敏感文件不能预览", 403);
  }
  return actual;
}

function safeDirectory(root: string, relativePath: string): string {
  if (!relativePath) return root;
  const absolute = safePath(root, relativePath);
  if ([relativePath, path.relative(root, absolute)].some(value => value.split(/[\\/]/).some(part => ignoredDirectories.has(part)))) throw new DomainError("INVALID_PATH", "目录不可访问", 403, true);
  if (!fs.statSync(absolute).isDirectory()) {
    throw new DomainError("INVALID_PATH", "路径不是目录", 400, true);
  }
  return absolute;
}

function gitStatuses(root: string): Map<string, GitFileStatus> {
  const statuses = new Map<string, GitFileStatus>();
  try {
    const output = execFileSync(
      "git",
      ["-C", root, "status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const records = output.split("\0");
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (!record || record.length < 4) continue;
      const code = record.slice(0, 2);
      const filePath = record.slice(3);
      const status = code === "??"
        ? "untracked"
        : code.includes("U")
          ? "conflicted"
          : code.includes("R") || code.includes("C")
            ? "renamed"
            : code.includes("A")
              ? "added"
              : code.includes("D")
                ? "deleted"
                : code.includes("M") || code.includes("T")
                  ? "modified"
                  : undefined;
      if (status) statuses.set(filePath, status);
      if (code.includes("R") || code.includes("C")) index += 1;
    }
  } catch {
    // Non-git projects have no status overlay.
  }
  return statuses;
}

export function readProjectReference(reference: ProjectMessageReference): {name: string; data: string} {
  const resolve = () => {
    const root = projectRoot(reference.projectId);
    const absolute = safePath(root, reference.path);
    if ([reference.path, path.relative(root, absolute)].some(value => value.split(/[\\/]/).some(part => ignoredDirectories.has(part)))) throw new DomainError("INVALID_PATH", "参考文件位于不可访问目录", 403, true);
    return absolute;
  };
  let fd: number | undefined;
  try {
    const absolute = resolve();
    fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    const checked = resolve();
    const checkedStat = fs.statSync(checked);
    if (checked !== absolute || stat.dev !== checkedStat.dev || stat.ino !== checkedStat.ino) throw new DomainError("FILE_CHANGED", "参考文件路径发生变化，请重试", 409, true);
    if (!stat.isFile()) throw new DomainError("INVALID_FILE", "只能选择普通文件", 400, true);
    if (stat.size > 2 * 1024 * 1024) throw new DomainError("FILE_TOO_LARGE", "参考文件超过容量限制", 413, true);
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) { const n = fs.readSync(fd, buffer, offset, buffer.length - offset, offset); if (!n) break; offset += n; }
    const after = fs.fstatSync(fd);
    if (offset !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new DomainError("FILE_CHANGED", "参考文件发生变化，请重试", 409, true);
    return { name: path.basename(absolute), data: buffer.toString("base64") };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("REFERENCE_READ_FAILED", "无法读取参考文件，请检查后重试", 409, true);
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

export const projectFiles = {
  list(projectId: string, directoryPath = "") {
    const root = projectRoot(projectId);
    const directory = safeDirectory(root, directoryPath);
    const statuses = gitStatuses(root);
    const children = fs
      .readdirSync(directory, { withFileTypes: true })
      .filter(
        (entry) =>
          !entry.isSymbolicLink() &&
          !ignoredDirectories.has(entry.name) &&
          !sensitiveNames.some((pattern) => pattern.test(entry.name)),
      )
      .sort(
        (left, right) =>
          Number(right.isDirectory()) - Number(left.isDirectory()) ||
          left.name.localeCompare(right.name, "en", {
            numeric: true,
            sensitivity: "base",
          }),
      );
    const entries = children.slice(0, maxDirectoryEntries).map((child) => {
      const relative = path.relative(root, path.join(directory, child.name));
      return {
        path: relative,
        parentPath: directoryPath,
        name: child.name,
        type: child.isDirectory() ? "directory" as const : "file" as const,
        ...(statuses.get(relative) ? { gitStatus: statuses.get(relative) } : {}),
      };
    });
    return {
      entries,
      isGitRepository: fs.existsSync(path.join(root, ".git")),
      truncated: children.length > maxDirectoryEntries,
    };
  },

  read(projectId: string, relativePath: string) {
    const root = projectRoot(projectId);
    const absolute = safePath(root, relativePath);
    const stat = fs.statSync(absolute);
    if (!stat.isFile()) throw new DomainError("INVALID_FILE", "只能预览普通文件", 400, true);
    if (stat.size > maxPreviewBytes) {
      throw new DomainError("FILE_TOO_LARGE", "文件超过 512 KiB，不能预览", 413, true);
    }
    const buffer = fs.readFileSync(absolute);
    if (buffer.includes(0)) {
      throw new DomainError("BINARY_FILE", "二进制文件不能预览", 415, true);
    }
    return { path: relativePath, content: buffer.toString("utf8"), size: stat.size };
  },

  changes(projectId: string) {
    const root = projectRoot(projectId);
    if (!fs.existsSync(path.join(root, ".git"))) {
      return { isGitRepository: false, status: "", workingPatch: "", stagedPatch: "" } satisfies ProjectChanges;
    }
    try {
      const status = execFileSync(
        "git",
        ["-C", root, "status", "--short", "--untracked-files=all"],
        { encoding: "utf8", maxBuffer: maxDiffBytes, stdio: ["ignore", "pipe", "ignore"] },
      );
      const working = execFileSync(
        "git",
        ["-C", root, "diff", "--no-ext-diff", "--no-color"],
        { encoding: "utf8", maxBuffer: maxDiffBytes, stdio: ["ignore", "pipe", "ignore"] },
      );
      const staged = execFileSync(
        "git",
        ["-C", root, "diff", "--cached", "--no-ext-diff", "--no-color"],
        { encoding: "utf8", maxBuffer: maxDiffBytes, stdio: ["ignore", "pipe", "ignore"] },
      );
      return { isGitRepository: true, status, workingPatch: working, stagedPatch: staged } satisfies ProjectChanges;
    } catch {
      throw new DomainError("GIT_READ_FAILED", "无法读取项目变更，或变更内容超过 1 MiB", 422, true);
    }
  },
};
