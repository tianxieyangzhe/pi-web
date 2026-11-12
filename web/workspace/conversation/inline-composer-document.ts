export type InlineAttachment = { id: string; label: string; file?: File };
export const attachmentToken = (id: string) => `\uE000${id}\uE001`;
const tokens = /\uE000([^\uE001]+)\uE001/g;
export function attachmentIds(value: string) { return Array.from(value.matchAll(tokens), match => match[1]); }
export function composerText(value: string) { return value.replace(tokens, ""); }
export function splitComposer(value: string): Array<{text: string} | {id: string}> {
  const parts: Array<{text: string} | {id: string}> = []; let from = 0;
  for (const match of value.matchAll(tokens)) {
    if (match.index! > from) parts.push({text:value.slice(from, match.index)});
    parts.push({id:match[1]}); from = match.index! + match[0].length;
  }
  if (from < value.length) parts.push({text:value.slice(from)});
  return parts;
}
/** Read editable text without letting labels, remove buttons or image alt text become user input. */
export function readComposer(root: Node): string {
  function read(node: Node): string {
    if (node.nodeType === 3) return node.textContent ?? "";
    if (node.nodeType !== 1) return "";
    const element = node as HTMLElement;
    if (element.hasAttribute('data-pasted-text')) return element.dataset.pastedText ?? '';
    if (element.dataset.attachmentId) return attachmentToken(element.dataset.attachmentId);
    if (element.hasAttribute("data-caret-slot")) return children(node).replace("\u200B", "");
    if (element.tagName === "BR") return "\n";
    return children(node);
  }
  function children(node: Node): string {
    let value = "";
    for (const child of Array.from(node.childNodes)) {
      const block = child.nodeType === 1 && ["DIV", "P"].includes((child as Element).tagName);
      if (block && value && !value.endsWith("\n")) value += "\n";
      value += read(child);
      if (block && child !== node.lastChild && !value.endsWith("\n")) value += "\n";
    }
    return value;
  }
  return children(root);
}
