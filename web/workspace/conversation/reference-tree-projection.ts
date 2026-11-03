import type { SessionTree } from "../../domain/models";
type TreeItem = SessionTree["entries"][number];
export function isReferenceEntry(entry: Record<string, unknown>) {
  return entry.type === "custom_message" && entry.customType === "user_reference_files";
}
/** Follow a unique chain through Pi's system setup message; preserve every native node exactly once. */
export function referenceTreeProjection(tree: SessionTree) {
  const children = new Map<string, TreeItem[]>();
  for (const item of tree.entries) if (item.entry.parentId) {
    const siblings=children.get(item.entry.parentId) ?? [];siblings.push(item);children.set(item.entry.parentId,siblings);
  }
  const attachments = new Map<string, TreeItem[]>(), grouped = new Set<string>();
  for (const item of tree.entries) {
    if (!isReferenceEntry(item.entry)) continue;
    const visited = new Set([item.entry.id]);let parentId=item.entry.id;
    while (true) {
      const descendants = children.get(parentId) ?? [];
      if (descendants.length !== 1) break;
      const target=descendants[0].entry;
      if (visited.has(target.id)) break;visited.add(target.id);
      const role=(target.message as {role?:string} | undefined)?.role;
      if (target.type === "message" && role === "user") {
        attachments.set(target.id,[...(attachments.get(target.id)??[]),item]);grouped.add(item.entry.id);break;
      }
      if (target.type !== "message" || role !== "system") break;
      parentId=target.id;
    }
  }
  return { items: tree.entries.filter(item => !grouped.has(item.entry.id)), attachments };
}
