import fs from "node:fs";
import path from "node:path";
import type { Workspace } from "@/lib/runtimes/runtime-types";
import { database } from "@/lib/storage/database.server";
import { ensureWorkspaceBaseline } from "@/lib/workspace/workspace-data.server";

type WorkspaceRow = { id: string; name: string; created_at: string; local_path: string | null };
export const defaultWorkingDirectory = path.resolve(process.cwd(), "data");
fs.mkdirSync(defaultWorkingDirectory, { recursive: true });

function mapWorkspace(row: WorkspaceRow): Workspace {
  return { id: row.id, name: row.name, group: "项目", workingDirectory: row.local_path ?? defaultWorkingDirectory };
}

function workspaceRows(where = "", parameters: unknown[] = []) {
  return database.prepare(`
    SELECT w.id, w.name, w.created_at,
      (SELECT p.local_path FROM projects p WHERE p.workspace_id = w.id AND p.location_kind = 'local_path' ORDER BY p.created_at LIMIT 1) AS local_path
    FROM workspaces w ${where}
  `).all(...parameters) as WorkspaceRow[];
}

function seedDefaultWorkspace() {
  const timestamp = new Date().toISOString();
  database.prepare("INSERT OR IGNORE INTO workspaces (id, name, description, status, created_at, updated_at) VALUES ('default', '默认工作空间', NULL, 'active', ?, ?)").run(timestamp, timestamp);
  ensureWorkspaceBaseline({ workspaceId: "default" });
}
seedDefaultWorkspace();

export function listWorkspaces() {
  return workspaceRows("ORDER BY CASE WHEN w.id = 'default' THEN 0 ELSE 1 END, w.created_at, w.name").map(mapWorkspace);
}

export function getWorkspace(workspaceId: string) {
  const row = workspaceRows("WHERE w.id = ?", [workspaceId])[0];
  return row ? mapWorkspace(row) : undefined;
}

export function createWorkspace(input: { id: string; name: string }) {
  const timestamp = new Date().toISOString();
  database.transaction(() => {
    database.prepare("INSERT INTO workspaces (id, name, description, status, created_at, updated_at) VALUES (?, ?, NULL, 'active', ?, ?)").run(input.id, input.name, timestamp, timestamp);
    ensureWorkspaceBaseline({ workspaceId: input.id });
  })();
  return getWorkspace(input.id)!;
}

export function deleteWorkspace(workspaceId: string) {
  if (workspaceId === "default") throw new Error("默认工作空间不能删除");
  return database.prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId).changes > 0;
}
