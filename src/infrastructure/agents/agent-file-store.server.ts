import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DomainError } from "@/domain/errors";
import { validateDefinition } from "@/domain/agent-definition";
import { renderAgentMarkdown } from "@/domain/agent-markdown";
import type { AgentDefinition } from "@/domain/models";

export type AgentMarkdown = {
  agentId: string;
  revision: number;
  kind: "project";
  name: string;
  description: string | null;
  definition: AgentDefinition;
};

function rootPath() {
  return path.resolve(process.env.AI_WORKSPACE_AGENT_DIR ?? path.join(process.cwd(), ".data", "agents"));
}

function validId(value: string) {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new DomainError("INVALID_ROLE", "角色 ID 无效", 422, true);
}

export function serializeAgentMarkdown(value: AgentMarkdown): string {
  validId(value.agentId);
  const definition = validateDefinition(value.definition, value.kind);
  return renderAgentMarkdown({...value,definition});
}

function parseScalar(value: string): unknown {
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  try { return JSON.parse(value); } catch { throw new DomainError("ROLE_FILE_INVALID", "Agent.md frontmatter 格式无效", 409, true); }
}

export function parseAgentMarkdown(markdown: string): AgentMarkdown {
  if (Buffer.byteLength(markdown, "utf8") > 65536) throw new DomainError("ROLE_FILE_TOO_LARGE", "Agent.md 超过 64KiB", 413, true);
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new DomainError("ROLE_FILE_INVALID", "Agent.md 缺少应用规范 frontmatter", 409, true);
  const fields: Record<string, unknown> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!item || Object.hasOwn(fields, item[1])) throw new DomainError("ROLE_FILE_INVALID", "Agent.md frontmatter 含无效或重复字段", 409, true);
    fields[item[1]] = item[1] === "kind" ? item[2] : parseScalar(item[2]);
  }
  const allowed = ["agent_id", "revision", "kind", "name", "description", "capabilities"];
  if (Object.keys(fields).some(key => !allowed.includes(key)) || typeof fields.agent_id !== "string" || !Number.isInteger(fields.revision) || !["project"].includes(String(fields.kind)) || typeof fields.name !== "string" || fields.description !== null && typeof fields.description !== "string" || !fields.capabilities || typeof fields.capabilities !== "object" || Array.isArray(fields.capabilities)) {
    throw new DomainError("ROLE_FILE_INVALID", "Agent.md frontmatter 字段不符合规范", 409, true);
  }
  const agentId = fields.agent_id as string;
  validId(agentId);
  return {
    agentId,
    revision: fields.revision as number,
    kind: fields.kind as AgentMarkdown["kind"],
    name: fields.name as string,
    description: fields.description as string | null,
    definition: validateDefinition({ instructions: match[2].trim(), capabilities: fields.capabilities }, fields.kind as AgentMarkdown["kind"])
  };
}

export function agentVersionPath(agentId: string, revision: number) {
  validId(agentId);
  if (!Number.isInteger(revision) || revision < 1) throw new DomainError("ROLE_FILE_INVALID", "角色版本无效", 409, true);
  return path.join(rootPath(), agentId, `${revision}.md`);
}

export function writeAgentVersion(value: AgentMarkdown): { contentSha256: string; path: string } {
  const target = agentVersionPath(value.agentId, value.revision);
  const directory = path.dirname(target);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const parentReal = realpathSync(directory);
  const rootReal = existsSync(rootPath()) ? realpathSync(rootPath()) : path.resolve(rootPath());
  if (parentReal !== rootReal && !parentReal.startsWith(rootReal + path.sep)) throw new DomainError("ROLE_FILE_INVALID", "角色文件路径越界", 409, true);
  const content = serializeAgentMarkdown(value);
  const contentSha256 = createHash("sha256").update(content).digest("hex");
  if (existsSync(target)) {
    const current = readFileSync(target);
    if (createHash("sha256").update(current).digest("hex") !== contentSha256) throw new DomainError("WRITE_CONFLICT", "该角色版本文件已存在且内容不同", 409, true);
    return { contentSha256, path: target };
  }
  const temp = path.join(directory, `.${value.revision}.${randomUUID()}.tmp`);
  try {
    const fd=openSync(temp,"wx",0o600);try{writeFileSync(fd,content);fsyncSync(fd);}finally{closeSync(fd);}
    try{linkSync(temp,target);unlinkSync(temp);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(createHash('sha256').update(readFileSync(target)).digest('hex')!==contentSha256)throw new DomainError('WRITE_CONFLICT','版本候选冲突，既有文件保持不变',409,true);unlinkSync(temp);}
    const parent=openSync(directory,"r");try{fsyncSync(parent);}finally{closeSync(parent);}
  } catch (error) {
    try { rmSync(temp, { force: true }); } catch {}
    throw error;
  }
  return { contentSha256, path: target };
}

export function readAgentVersion(agentId: string, revision: number, expectedSha256?: string | null): AgentMarkdown & { contentSha256: string; path: string; markdown:string } {
  const target = agentVersionPath(agentId, revision);
  try {
    const info = lstatSync(target);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("not a regular file");
    const real = realpathSync(target), base = realpathSync(path.dirname(target)),root=realpathSync(rootPath());
    if ((!base.startsWith(root+path.sep)&&base!==root)||(!real.startsWith(base + path.sep) && real !== base)) throw new Error("path escape");
    const bytes = readFileSync(target);
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    if (expectedSha256 && expectedSha256 !== contentSha256) throw new DomainError("ROLE_FILE_HASH_MISMATCH", "Agent.md 版本摘要不匹配", 409, true);
    const parsed = parseAgentMarkdown(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (parsed.agentId !== agentId || parsed.revision !== revision) throw new DomainError("ROLE_FILE_IDENTITY_MISMATCH", "Agent.md 身份或版本不匹配", 409, true);
    return { ...parsed, contentSha256, path: target, markdown:new TextDecoder("utf-8",{fatal:true}).decode(bytes) };
  } catch (error) {
    throw new DomainError("ROLE_VERSION_MISSING", "Agent Markdown 版本缺失或不可读", 409, true);
  }
}

export function deleteAgentFiles(agentId: string) {
  validId(agentId);
  const target = path.join(rootPath(), agentId);
  if (!existsSync(target)) return;
  const info = lstatSync(target);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new DomainError("ROLE_FILE_INVALID", "角色版本目录无效", 409, true);
  rmSync(target, { recursive: true, force: false });
}
