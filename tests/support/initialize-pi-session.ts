import fs from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { DomainError } from "@/domain/errors";
import { readNativeFile } from "../../src/infrastructure/pi/session-tree.server";

/** Creates deterministic native files for controlled SDK tests only. Production uses PiSessionRuntime initialization. */
export function initializeSession(identity: string, cwd: string, directory: string) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, createHash("sha256").update(identity).digest("hex") + ".jsonl"), lock = file + ".lock";
  try { fs.mkdirSync(lock, { mode: 0o700 }); } catch { throw new DomainError("SESSION_INITIALIZATION_LOCKED", "会话初始化锁未释放，请核对现场", 409, true); }
  try {
    if (!fs.existsSync(file)) { fs.closeSync(fs.openSync(file, "wx", 0o600)); SessionManager.open(file, directory, cwd); }
    const verified = readNativeFile(file, cwd);
    if (!verified.endsWithNewline) throw new DomainError("SESSION_TREE_READ_FAILED", "原生历史末尾不完整", 500, true);
    return SessionManager.open(file, directory, cwd);
  } finally { fs.rmdirSync(lock); }
}
