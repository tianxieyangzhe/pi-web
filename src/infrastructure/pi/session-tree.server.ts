import { readFileSync } from "node:fs";
import { CURRENT_SESSION_VERSION, SessionManager, type FileEntry, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { DomainError } from "@/domain/errors";

const failure = () => new DomainError("SESSION_TREE_READ_FAILED", "无法完整读取 Pi 会话树，请检查原生历史完整性和版本", 500, true);
const missing = () => new DomainError("NO_NATIVE_REF", "Pi 原生历史缺失或身份不一致", 409, true);

export function snapshotTree(manager: Pick<SessionManager, "getEntries" | "getTree" | "getLeafId">) {
  try {
    const entries = manager.getEntries();
    const byId = new Map<string, SessionEntry>();
    for (const e of entries) {
      if (!e || typeof e.id !== "string" || !e.id || byId.has(e.id) || (e.parentId !== null && typeof e.parentId !== "string") || typeof e.type !== "string" || typeof e.timestamp !== "string") throw failure();
      byId.set(e.id, e);
    }
    const done = new Set<string>();
    for (const e of entries) {
      const visited = new Set<string>();
      let current: SessionEntry | undefined = e;
      while (current && !done.has(current.id)) {
        if (visited.has(current.id)) throw failure();
        visited.add(current.id);
        if (current.parentId === null || current.parentId === current.id) break;
        current = byId.get(current.parentId);
      }
      for (const id of visited) done.add(id);
    }
    const labels = new Map<string, { label: string | null; labelTimestamp: string | null }>();
    const nodes = [...manager.getTree()];
    while (nodes.length) {
      const node = nodes.pop()!;
      if (!byId.has(node.entry.id) || labels.has(node.entry.id)) throw failure();
      labels.set(node.entry.id, { label: node.label ?? null, labelTimestamp: node.labelTimestamp ?? null });
      nodes.push(...node.children);
    }
    if (labels.size !== entries.length) throw failure();
    const activeLeafId = manager.getLeafId();
    if (activeLeafId !== null && !byId.has(activeLeafId)) throw failure();
    const result = { entries: entries.map(entry => ({ entry, ...labels.get(entry.id)! })), activeLeafId };
    JSON.stringify(result);
    return result;
  } catch (error) { if (error instanceof DomainError) throw error; throw failure(); }
}

export function readNativeFile(file: string, cwd: string, expectedId?: string) {
  let text: string;
  let bytes: Buffer;
  try { bytes = readFileSync(file); } catch { throw missing(); }
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw failure(); }
  if (!text) throw missing();
  try {
    const lines = text.split("\n");
    if (lines.at(-1) === "") lines.pop();
    if (!lines.length || lines.some(line => !line.trim())) throw failure();
    const entries = lines.map(line => JSON.parse(line)) as FileEntry[];
    const header = entries[0];
    if (!header || header.type !== "session" || typeof header.id !== "string" || !header.id || header.cwd !== cwd || (expectedId !== undefined && header.id !== expectedId)) throw missing();
    if (header.version !== CURRENT_SESSION_VERSION || entries.slice(1).some(e => !e || typeof e !== "object" || e.type === "session")) throw failure();
    snapshotTree(SessionManager.inMemory(cwd, undefined, entries));
    return { entries, header, endsWithNewline: text.endsWith("\n") };
  } catch (error) { if (error instanceof DomainError) throw error; throw failure(); }
}
export function readTreeFile(file: string, cwd: string, expectedId: string) {
  const { entries } = readNativeFile(file, cwd, expectedId);
  return snapshotTree(SessionManager.inMemory(cwd, undefined, entries));
}
