import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type DirectoryEntry = {
  name: string;
  path: string;
};

function resolveDirectory(directoryPath?: string) {
  const candidate = directoryPath?.trim() || os.homedir();
  if (!path.isAbsolute(candidate)) throw new Error("目录路径无效");
  const resolved = path.resolve(candidate);
  const stats = fs.statSync(resolved);
  if (!stats.isDirectory()) throw new Error("所选路径不是目录");
  return fs.realpathSync(resolved);
}

export function listDirectories(directoryPath?: string) {
  const currentPath = resolveDirectory(directoryPath);
  const parentPath = path.dirname(currentPath);
  const entries = fs.readdirSync(currentPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => ({ name: entry.name, path: path.join(currentPath, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    currentPath,
    currentDirectoryName: path.basename(currentPath) || currentPath,
    parentPath: parentPath === currentPath ? null : parentPath,
    entries,
  };
}
