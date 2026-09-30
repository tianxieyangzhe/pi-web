import type { ReactNode } from "react";

type InlineToken = { kind: "text" | "code" | "strong" | "emphasis" | "strike" | "link"; value: string; href?: string };

function isSafeHref(href: string) {
  const value = href.trim();
  if (!value || /[\u0000-\u001f]/.test(value)) return false;
  if (value.startsWith("#") || value.startsWith("/") && !value.startsWith("//") || value.startsWith("./") || value.startsWith("../")) return true;
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function tokenizeInline(value: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern = /(`[^`]+`|\[[^\]]+\]\([^\s)]+(?:\s+[^)]*)?\)|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|_[^_]+_)/g;
  let cursor = 0;

  for (const match of value.matchAll(pattern)) {
    const token = match[0];
    const start = match.index ?? cursor;
    if (start > cursor) tokens.push({ kind: "text", value: value.slice(cursor, start) });

    if (token.startsWith("`")) {
      tokens.push({ kind: "code", value: token.slice(1, -1) });
    } else if (token.startsWith("[")) {
      const separator = token.indexOf("](");
      const label = token.slice(1, separator);
      const href = token.slice(separator + 2, -1).split(/\s+/, 1)[0];
      tokens.push(isSafeHref(href) ? { kind: "link", value: label, href } : { kind: "text", value: label });
    } else if (token.startsWith("**") || token.startsWith("__")) {
      tokens.push({ kind: "strong", value: token.slice(2, -2) });
    } else if (token.startsWith("~~")) {
      tokens.push({ kind: "strike", value: token.slice(2, -2) });
    } else {
      tokens.push({ kind: "emphasis", value: token.slice(1, -1) });
    }
    cursor = start + token.length;
  }

  if (cursor < value.length) tokens.push({ kind: "text", value: value.slice(cursor) });
  return tokens;
}

function InlineMarkdown({ value }: { value: string }) {
  const nodes: ReactNode[] = [];
  tokenizeInline(value).forEach((token, index) => {
    if (token.kind === "code") nodes.push(<code className="rounded border border-[#e7ebf2] bg-[#f4f6fa] px-1 py-0.5 font-mono text-[.9em] text-[#37517c]" key={index}>{token.value}</code>);
    else if (token.kind === "strong") nodes.push(<strong className="font-semibold" key={index}>{token.value}</strong>);
    else if (token.kind === "emphasis") nodes.push(<em key={index}>{token.value}</em>);
    else if (token.kind === "strike") nodes.push(<del key={index}>{token.value}</del>);
    else if (token.kind === "link") {
      const external = /^https?:\/\//i.test(token.href ?? "");
      nodes.push(<a className="text-[#2455a3] underline underline-offset-2" key={index} href={token.href} target={external ? "_blank" : undefined} rel={external ? "noreferrer noopener" : undefined}>{token.value}</a>);
    }
    else nodes.push(token.value);
  });
  return <>{nodes}</>;
}

function splitTableRow(value: string) {
  return value.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableSeparator(value: string) {
  const cells = splitTableRow(value);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isBlockStart(lines: string[], index: number) {
  const line = lines[index] ?? "";
  return /^\s*```/.test(line)
    || /^#{1,6}\s/.test(line)
    || /^\s*>/.test(line)
    || /^\s*(?:[-*_]\s*){3,}$/.test(line)
    || /^\s*(?:[-+*]|\d+[.)])\s+/.test(line)
    || Boolean(lines[index + 1] && line.includes("|") && isTableSeparator(lines[index + 1]));
}

function renderBlocks(source: string, prefix: string): ReactNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const fence = line.match(/^\s*```\s*([\w.+-]*)/);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) codeLines.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push(<pre className="m-0 max-w-full overflow-auto rounded-lg border border-[#e2e9f4] bg-[#f6f8fc] p-3 font-mono text-xs leading-relaxed text-[#29364c]" key={`${prefix}-${blocks.length}`}><code className={fence[1] ? `language-${fence[1]}` : undefined}>{codeLines.join("\n")}</code></pre>);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const content = <InlineMarkdown value={heading[2]} />;
      const key = `${prefix}-${blocks.length}`;
      if (level === 1) blocks.push(<h1 className="m-0 text-xl font-semibold tracking-tight" key={key}>{content}</h1>);
      else if (level === 2) blocks.push(<h2 className="m-0 text-lg font-semibold tracking-tight" key={key}>{content}</h2>);
      else if (level === 3) blocks.push(<h3 className="m-0 text-base font-semibold" key={key}>{content}</h3>);
      else if (level === 4) blocks.push(<h4 className="m-0 font-semibold" key={key}>{content}</h4>);
      else if (level === 5) blocks.push(<h5 className="m-0 text-sm font-semibold" key={key}>{content}</h5>);
      else blocks.push(<h6 className="m-0 text-xs font-semibold uppercase tracking-wide" key={key}>{content}</h6>);
      index += 1;
      continue;
    }

    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
      blocks.push(<hr className="w-full border-0 border-t border-[#e4eaf3]" key={`${prefix}-${blocks.length}`} />);
      index += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) quoteLines.push(lines[index++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote className="m-0 border-l-[3px] border-[#b8cdf2] py-0.5 pl-3.5 text-[#60708a]" key={`${prefix}-${blocks.length}`}>{renderBlocks(quoteLines.join("\n"), `${prefix}-quote-${blocks.length}`)}</blockquote>);
      continue;
    }

    const listMatch = line.match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.*)$/);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.*)$/);
        if (!item || Boolean(item[2]) !== ordered) break;
        items.push(item[3]);
        index += 1;
      }
      const key = `${prefix}-${blocks.length}`;
      if (ordered) blocks.push(<ol className="m-0 grid list-decimal gap-1.5 pl-6" key={key}>{items.map((item, itemIndex) => <li key={itemIndex}><InlineMarkdown value={item} /></li>)}</ol>);
      else blocks.push(<ul className="m-0 grid list-disc gap-1.5 pl-6" key={key}>{items.map((item, itemIndex) => <li key={itemIndex}><InlineMarkdown value={item} /></li>)}</ul>);
      continue;
    }

    if (index + 1 < lines.length && line.includes("|") && isTableSeparator(lines[index + 1])) {
      const headers = splitTableRow(line);
      const alignments = splitTableRow(lines[index + 1]).map((cell) => cell.startsWith(":") ? cell.endsWith(":") ? "center" : "left" : cell.endsWith(":") ? "right" : undefined);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(splitTableRow(lines[index++]));
      blocks.push(<div className="max-w-full overflow-auto" key={`${prefix}-${blocks.length}`}><table className="w-full border-collapse text-[.92em]"><thead><tr>{headers.map((cell, cellIndex) => <th className="min-w-[84px] border border-[#e1e8f2] bg-[#f5f8fd] px-2.5 py-2 font-semibold text-[#3b4c68]" key={cellIndex} style={{ textAlign: alignments[cellIndex] }}><InlineMarkdown value={cell} /></th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, cellIndex) => <td className="min-w-[84px] border border-[#e1e8f2] px-2.5 py-2 align-top" key={cellIndex} style={{ textAlign: alignments[cellIndex] }}><InlineMarkdown value={row[cellIndex] ?? ""} /></td>)}</tr>)}</tbody></table></div>);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !(paragraph.length > 0 && isBlockStart(lines, index))) paragraph.push(lines[index++]);
    blocks.push(<p className="m-0" key={`${prefix}-${blocks.length}`}>{paragraph.map((part, partIndex) => <span key={partIndex}>{partIndex > 0 && <br />}<InlineMarkdown value={part} /></span>)}</p>);
  }

  return blocks;
}

export function Response({ children, className = "" }: { children: string; className?: string }) {
  return <div className={`markdown-response grid min-w-0 gap-2.5 break-words whitespace-normal [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ${className}`.trim()}>{renderBlocks(children, "response")}</div>;
}
