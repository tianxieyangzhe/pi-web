import fs from "node:fs";
import path from "node:path";
import { DomainError, requiredText } from "@/domain/errors";

export function normalizeProjectRoot(value: unknown): string {
  const candidate = requiredText(value, "rootPath", "项目路径");
  if (!path.isAbsolute(candidate)) {
    throw new DomainError("INVALID_PROJECT_PATH", "项目路径必须是绝对路径", 400, true);
  }
  try {
    const resolved = fs.realpathSync(candidate);
    if (!fs.statSync(resolved).isDirectory()) throw new Error("not a directory");
    fs.accessSync(resolved, fs.constants.R_OK);
    return resolved;
  } catch {
    throw new DomainError(
      "INVALID_PROJECT_PATH",
      "项目路径不存在、不是目录或不可读取",
      400,
      true,
    );
  }
}
