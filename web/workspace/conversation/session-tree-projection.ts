import type { SessionTree } from "../../domain/models";
import type { TemporaryNode } from "./use-session-tree";

export type ContentBlock = { type: string; text?: string; thinking?: string; name?: string; id?: string; arguments?: unknown; [key: string]: unknown };
export function contentBlocks(content: unknown): ContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return content == null ? [] : [{ type: "unknown", value: content }];
  return content.map(block => block && typeof block === "object" && typeof block.type === "string" ? block : { type: "unknown", value: block });
}
export function treeRelations(tree: SessionTree) {
  const entries = new Map(tree.entries.map(item => [item.entry.id, item.entry]));
  const active = new Set<string>(), children = new Map<string, number>();
  let id = tree.activeLeafId;
  while (id && !active.has(id)) { active.add(id); id = entries.get(id)?.parentId ?? null; }
  for (const { entry } of tree.entries) if (entry.parentId && entry.parentId !== entry.id && entries.has(entry.parentId)) children.set(entry.parentId, (children.get(entry.parentId) ?? 0) + 1);
  return { entries, active, children };
}
export function temporaryMessage(node: TemporaryNode): Record<string, unknown> | null {
  for (let i = node.events.length - 1; i >= 0; i--) {
    const payload = node.events[i].payload as { message?: Record<string, unknown> } | null;
    if (payload?.message) return payload.message;
  }
  return null;
}
