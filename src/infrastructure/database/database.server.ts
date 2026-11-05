import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DomainError } from "@/domain/errors";
import {matchesTargetSchema} from './schema-compatibility';
import { targetSchema } from "./schema.server";
const defaultPath = path.resolve(process.cwd(), ".data", "ai-workspace-v5.sqlite");
const configuredPath = process.env.AI_WORKSPACE_DB_PATH;
const databasePath = path.resolve(configuredPath || defaultPath);
if (configuredPath && databasePath !== defaultPath) throw new DomainError("SCHEMA_INCOMPATIBLE", "数据库文件固定为 .data/ai-workspace-v5.sqlite。", 409, true);
const exists = fs.existsSync(databasePath);
let compatible = !exists;
if (exists) {
  const inspection = new Database(databasePath, { readonly: true, fileMustExist: true });
  compatible=matchesTargetSchema(inspection,targetSchema);
  inspection.close();
}
if (!exists) fs.mkdirSync(path.dirname(databasePath), { recursive: true });
export const database = new Database(databasePath, { readonly: !compatible });
export const schemaCompatible = compatible;
export function assertSchemaCompatible() {
  if (!schemaCompatible) throw new DomainError("SCHEMA_INCOMPATIBLE", "历史数据库尚未采用会话退役目标结构，已阻止写入；请单独决定备份、归档及显式升级。", 409, true);
}
database.pragma("busy_timeout = 5000");
database.pragma("foreign_keys = ON");
if (compatible) {
  const hasTables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length > 0;
  if (!hasTables) database.exec(targetSchema);
}
export function getDatabasePath() { return databasePath; }
