import { createHash } from "node:crypto";
import { DomainError } from "./errors";
export type SessionMemoryOutput = { title: string; summary: string; path: string | null };
export type SessionMemoryContext = { summary: string; goal: string; constraints: string[]; facts: string[]; decisions: string[]; nextActions: string[]; outputs: SessionMemoryOutput[] };
export type SessionMemoryDraft = { id: string; context: SessionMemoryContext; baseContextHash: string; source: "template" | "rule" | "llm"; sourceAfterEntryId: string | null; sourceThroughEntryId: string | null; inputTokens: number | null; outputTokens: number | null; generatedAt: string };
export type SessionMemory = { id: string; projectId: string | null; sourceTemplateId: string | null; title: string; contextJson: SessionMemoryContext; draftJson: SessionMemoryDraft | null; lastReviewedEntryId: string | null; createdAt: string; updatedAt: string };
export const contextKeys = ["summary", "goal", "constraints", "facts", "decisions", "nextActions", "outputs"] as const;
export const emptyContext = (): SessionMemoryContext => ({ summary: "", goal: "", constraints: [], facts: [], decisions: [], nextActions: [], outputs: [] });
function invalid(field: string): never { throw new DomainError("INVALID_MEMORY_CONTEXT", `会话上下文字段无效：${field}`, 422, true, { [field]: ["类型、长度或内容不符合要求"] }); }
function object(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(key => !(key in result))) invalid(field);
  return result;
}
function text(value: unknown, max: number, field: string, nonempty = false): string {
  if (typeof value !== "string") invalid(field);
  const result = value.replace(/\r\n?/g, "\n").trim();
  if ([...result].length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result) || (nonempty && !result)) invalid(field);
  if (/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+\S+)/i.test(result)) invalid(field);
  if (/((?:OPENAI|API|ACCESS|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\s*[:=]\s*)(?!\[已隐藏)[^\s,;]+/i.test(result)) invalid(field);
  return result;
}
export function safeOutputPath(value: unknown): string | null {
  if (value === null) return null;
  const path = text(value, 512, "outputs.path", true);
  if (path.startsWith("/") || /^[a-z]:/i.test(path) || path.includes("\\") || path.split("/").some(segment => !segment || segment === "." || segment === ".." || /^(?:\.env(?:\.|$)|\.git$|\.ssh$|\.aws$|\.codex$|\.npmrc$|credentials?|id_rsa|node_modules$)/i.test(segment))) invalid("outputs.path");
  return path;
}
export function validateContext(value: unknown, template = false): SessionMemoryContext {
  const input = object(value, contextKeys, "context");
  const list = (key: string): string[] => {
    const values = input[key]; if (!Array.isArray(values) || values.length > 20) invalid(key);
    const result = values.map(item => text(item, 300, key, true)); if (new Set(result).size !== result.length) invalid(key); return result;
  };
  if (!Array.isArray(input.outputs) || input.outputs.length > 20) invalid("outputs");
  const result: SessionMemoryContext = { summary: text(input.summary, 1000, "summary"), goal: text(input.goal, 1000, "goal"), constraints: list("constraints"), facts: list("facts"), decisions: list("decisions"), nextActions: list("nextActions"), outputs: input.outputs.map(item => { const out = object(item, ["title", "summary", "path"], "outputs"); return { title: text(out.title, 120, "outputs.title", true), summary: text(out.summary, 500, "outputs.summary"), path: safeOutputPath(out.path) }; }) };
  const strings = [result.summary, result.goal, ...result.constraints, ...result.facts, ...result.decisions, ...result.nextActions, ...result.outputs.flatMap(out => [out.title, out.summary, out.path ?? ""])];
  if (strings.reduce((sum, item) => sum + [...item].length, 0) > 8000) invalid("context");
  if (template && (result.facts.length || result.decisions.length || result.nextActions.length || result.outputs.length)) invalid("template");
  return result;
}
export function validateDraft(value: unknown): SessionMemoryDraft {
  const draft = object(value, ["id", "context", "baseContextHash", "source", "sourceAfterEntryId", "sourceThroughEntryId", "inputTokens", "outputTokens", "generatedAt"], "draft");
  const id = (v: unknown) => v === null ? null : text(v, 256, "draft.sourceId", true);
  if (!['template', 'rule', 'llm'].includes(String(draft.source)) || !/^[a-f0-9]{64}$/.test(String(draft.baseContextHash)) || typeof draft.generatedAt !== 'string' || !Number.isFinite(Date.parse(draft.generatedAt))) invalid("draft");
  for (const key of ['inputTokens', 'outputTokens']) if (draft[key] !== null && (!Number.isInteger(draft[key]) || Number(draft[key]) < 0)) invalid(key);
  const result = { ...draft, id: text(draft.id, 256, "draft.id", true), context: validateContext(draft.context), sourceAfterEntryId: id(draft.sourceAfterEntryId), sourceThroughEntryId: id(draft.sourceThroughEntryId) } as SessionMemoryDraft;
  if (result.source === 'template' ? (result.sourceAfterEntryId !== null || result.sourceThroughEntryId !== null) : !result.sourceThroughEntryId) invalid("draft.source");
  return result;
}
export const contextHash = (value: SessionMemoryContext) => createHash("sha256").update(JSON.stringify(validateContext(value))).digest("hex");
export const sessionMemoryETag = (memory: SessionMemory) => `"${createHash("sha256").update(JSON.stringify(memory)).digest("hex")}"`;
