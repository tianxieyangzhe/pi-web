"use client";

import type { ReactNode } from "react";
import { CodeBlock } from "@/shared/ui/ai-elements/code-block";

type InlineKind = "code" | "image" | "link" | "strong" | "strike" | "emphasis" | "autolink";

type InlineMatch = {
  kind: InlineKind;
  index: number;
  raw: string;
  values: string[];
};

function safeHref(value: string): string | null {
  const href = value.trim();
  if (href.startsWith("/") || href.startsWith("#")) return href;
  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? href : null;
  } catch {
    return null;
  }
}

function textWithBreaks(value: string, key: string): ReactNode[] {
  const lines = value.split("\n");
  const output: ReactNode[] = [];
  lines.forEach((line, index) => {
    output.push(line);
    if (index < lines.length - 1) output.push(<br key={`${key}-br-${index}`} />);
  });
  return output;
}

function firstInlineMatch(value: string): InlineMatch | null {
  const patterns: Array<{ kind: InlineKind; expression: RegExp }> = [
    { kind: "code", expression: /`([^`\n]+)`/ },
    { kind: "image", expression: /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/ },
    { kind: "link", expression: /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/ },
    { kind: "strong", expression: /\*\*([^*\n]+)\*\*|__([^_\n]+)__/ },
    { kind: "strike", expression: /~~([^~\n]+)~~/ },
    { kind: "emphasis", expression: /\*([^*\n]+)\*|_([^_\n]+)_/ },
    { kind: "autolink", expression: /<(https?:\/\/[^ >]+|mailto:[^ >]+)>/ },
  ];
  let first: InlineMatch | null = null;
  for (const pattern of patterns) {
    const match = pattern.expression.exec(value);
    if (!match || (first && match.index >= first.index)) continue;
    first = {
      kind: pattern.kind,
      index: match.index,
      raw: match[0],
      values: match.slice(1).filter((item): item is string => item !== undefined),
    };
  }
  return first;
}

function inline(value: string, key: string): ReactNode[] {
  const match = firstInlineMatch(value);
  if (!match) return textWithBreaks(value, key);
  const before = value.slice(0, match.index);
  const after = value.slice(match.index + match.raw.length);
  const parts: ReactNode[] = [...textWithBreaks(before, `${key}-before`)];
  const content = match.values[0] ?? "";

  if (match.kind === "code") {
    parts.push(<code key={`${key}-match`}>{content}</code>);
  } else if (match.kind === "strong") {
    parts.push(<strong key={`${key}-match`}>{inline(content, `${key}-strong`)}</strong>);
  } else if (match.kind === "strike") {
    parts.push(<del key={`${key}-match`}>{inline(content, `${key}-strike`)}</del>);
  } else if (match.kind === "emphasis") {
    parts.push(<em key={`${key}-match`}>{inline(content, `${key}-emphasis`)}</em>);
  } else if (match.kind === "image") {
    const href = safeHref(match.values[1] ?? "");
    parts.push(href
      ? <a key={`${key}-match`} href={href} target="_blank" rel="noreferrer">图片：{content || href}</a>
      : <span key={`${key}-match`}>图片：{content}</span>);
  } else {
    const href = safeHref(match.kind === "autolink" ? content : match.values[1] ?? "");
    const label = match.kind === "autolink" ? content : content;
    parts.push(href
      ? <a key={`${key}-match`} href={href} target={href.startsWith("/") || href.startsWith("#") ? undefined : "_blank"} rel="noreferrer">{inline(label, `${key}-link`)}</a>
      : <span key={`${key}-match`}>{label}</span>);
  }
  parts.push(...inline(after, `${key}-after`));
  return parts;
}

function tableCells(line: string): string[] {
  const value = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return value.split("|").map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  return /^\s*```/.test(line) || /^#{1,6}\s+/.test(line) || /^\s*>/.test(line) ||
    /^\s*(?:[-+*]|\d+\.)\s+/.test(line) || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    (line.includes("|") && isTableSeparator(lines[index + 1] ?? ""));
}

function blocks(source: string, key: string): ReactNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const output: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = /^\s*```([^\s`]*)\s*$/.exec(line);
    if (fence) {
      const language = fence[1];
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      output.push(<CodeBlock key={`${key}-code-${index}`} code={code.join("\n")} language={language || undefined} />);
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = inline(heading[2], `${key}-heading-${index}`);
      output.push(level === 1 ? <h1 key={`${key}-${index}`}>{content}</h1>
        : level === 2 ? <h2 key={`${key}-${index}`}>{content}</h2>
          : level === 3 ? <h3 key={`${key}-${index}`}>{content}</h3>
            : level === 4 ? <h4 key={`${key}-${index}`}>{content}</h4>
              : level === 5 ? <h5 key={`${key}-${index}`}>{content}</h5>
                : <h6 key={`${key}-${index}`}>{content}</h6>);
      index += 1;
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      output.push(<hr key={`${key}-hr-${index}`} />);
      index += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quoted.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      output.push(<blockquote key={`${key}-quote-${index}`}>{blocks(quoted.join("\n"), `${key}-quote-${index}`)}</blockquote>);
      continue;
    }

    const listItem = /^\s*([-+*]|\d+\.)\s+(.+)$/.exec(line);
    if (listItem) {
      const ordered = /\d+\./.test(listItem[1]);
      const items: Array<{ checked: boolean | null; value: string }> = [];
      while (index < lines.length) {
        const item = /^\s*([-+*]|\d+\.)\s+(.+)$/.exec(lines[index]);
        if (!item || /\d+\./.test(item[1]) !== ordered) break;
        const task = /^\[([ xX])\]\s+(.+)$/.exec(item[2]);
        items.push({ checked: task ? task[1].toLowerCase() === "x" : null, value: task ? task[2] : item[2] });
        index += 1;
      }
      const children = items.map((item, itemIndex) => <li key={`${key}-item-${index}-${itemIndex}`} className={item.checked === null ? undefined : "-ml-5 flex list-none items-start gap-2"}>{item.checked !== null && <input className="mt-1.5 accent-teal-700" type="checkbox" checked={item.checked} readOnly aria-label={item.checked ? "已完成" : "未完成"} />}{inline(item.value, `${key}-item-${index}-${itemIndex}`)}</li>);
      output.push(ordered ? <ol key={`${key}-list-${index}`}>{children}</ol> : <ul key={`${key}-list-${index}`}>{children}</ul>);
      continue;
    }

    if (line.includes("|") && isTableSeparator(lines[index + 1] ?? "")) {
      const headers = tableCells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      output.push(<div className="my-3 max-w-full overflow-auto" key={`${key}-table-${index}`}><table className="min-w-full border-collapse text-[11px]"><thead><tr>{headers.map((cell, cellIndex) => <th className="border border-slate-200 bg-slate-100 px-2 py-1.5 text-left" key={cellIndex}>{inline(cell, `${key}-th-${cellIndex}`)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, cellIndex) => <td className="border border-slate-200 px-2 py-1.5 align-top" key={cellIndex}>{inline(row[cellIndex] ?? "", `${key}-td-${rowIndex}-${cellIndex}`)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    output.push(<p key={`${key}-paragraph-${index}`}>{inline(paragraph.join("\n"), `${key}-paragraph-${index}`)}</p>);
  }
  return output;
}

export function MarkdownResponse({ children, streaming = false }: { children: string; streaming?: boolean }) {
  return <div className={`min-w-0 text-inherit [&_a]:text-teal-700 [&_a]:underline [&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-teal-300 [&_blockquote]:bg-teal-50 [&_blockquote]:px-3 [&_blockquote]:py-2 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[.9em] [&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:border-slate-200 [&_h2]:pb-1 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-bold [&_li]:my-1 [&_ol]:my-2 [&_ol]:pl-6 [&_p]:mb-2 [&_pre]:my-3 [&_ul]:my-2 [&_ul]:pl-6 ${streaming ? "" : ""}`}>{blocks(children, "markdown")}</div>;
}
