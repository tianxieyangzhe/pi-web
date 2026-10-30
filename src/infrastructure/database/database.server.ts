import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DomainError } from "@/domain/errors";
import { targetSchema } from "./schema.server";
const defaultPath = path.resolve(process.cwd(), ".data", "ai-workspace-v5.sqlite");
const configuredPath = process.env.AI_WORKSPACE_DB_PATH;
const databasePath = path.resolve(configuredPath || defaultPath);
if (configuredPath && databasePath !== defaultPath) throw new DomainError("SCHEMA_INCOMPATIBLE", "数据库文件固定为 .data/ai-workspace-v5.sqlite。", 409, true);
const retiredTables = ["bot_works", "bot_tasks", "bot_task_dependencies", "bot_executions", "bot_messages"];
const exists = fs.existsSync(databasePath);
let compatible = !exists;
if (exists) {
  const inspection = new Database(databasePath, { readonly: true, fileMustExist: true });
  const names = new Set(inspection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => String((row as { name: string }).name)));
  const required = ["projects", "agents", "sessions", "session_memories", "bots", "bot_conversations", "project_calls"];
  compatible = required.every(name => names.has(name)) && ![...names].some(name => name.startsWith("legacy_v5_") || retiredTables.includes(name));
  inspection.close();
}
if (!exists) fs.mkdirSync(path.dirname(databasePath), { recursive: true });
export const database = new Database(databasePath, { readonly: !compatible });
export const schemaCompatible = compatible;
export function assertSchemaCompatible() {
  if (!schemaCompatible) throw new DomainError("SCHEMA_INCOMPATIBLE", "数据库仍有废弃表或缺少 project_calls，已阻止写入。", 409, true);
}
database.pragma("busy_timeout = 5000");
database.pragma("foreign_keys = ON");
if (compatible) {
  const hasTables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length > 0;
  if (!hasTables) database.exec(targetSchema);
}
export function getDatabasePath() { return databasePath; }
