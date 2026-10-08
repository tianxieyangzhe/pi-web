import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DomainError } from "@/domain/errors";
import { targetSchema } from "./schema.server";
const databasePath = process.env.AI_WORKSPACE_DB_PATH ?? path.join(process.cwd(), ".data", "ai-workspace-v5.sqlite");
const exists = fs.existsSync(databasePath);
let compatible = !exists;
if (exists) {
  const inspection = new Database(databasePath, { readonly: true });
  const tables = inspection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  const columns = inspection.prepare("PRAGMA table_info(session_memories)").all() as Array<{name: string}>;
  const sessionColumns = inspection.prepare("PRAGMA table_info(sessions)").all() as Array<{name:string;notnull:number}>;
  const required=["project_id","source_template_id","context_json","draft_json","last_reviewed_entry_id"];
  const indexes=inspection.prepare("PRAGMA index_list(sessions)").all() as Array<{name:string;unique:number}>;
  const uniqueSessionMemory=indexes.some(index=>index.unique===1&&(inspection.prepare(`PRAGMA index_info(\"${index.name.replaceAll('\"','\"\"')}\")`).all() as Array<{name:string}>).map(x=>x.name).join(",")==="session_memory_id");
  compatible = tables.length === 0 || (required.every(name=>columns.some(column=>column.name===name))&&sessionColumns.some(column=>column.name==="session_memory_id"&&column.notnull===1)&&uniqueSessionMemory);
  inspection.close();
}
if (!exists) fs.mkdirSync(path.dirname(databasePath), { recursive: true });
export const database = new Database(databasePath, { readonly: !compatible });
export const schemaCompatible = compatible;
export function assertSchemaCompatible() {
  if (!schemaCompatible) throw new DomainError("SCHEMA_INCOMPATIBLE", "旧数据库缺少单项目 SessionMemory 结构，已阻止写入。请先审查并执行独立迁移脚本；历史记录已保留。", 409, true);
}
database.pragma("busy_timeout = 5000");
database.pragma("foreign_keys = ON");
if (compatible) {
  const hasTables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length > 0;
  if (!hasTables) database.exec(targetSchema);
}
export function getDatabasePath() { return databasePath; }
