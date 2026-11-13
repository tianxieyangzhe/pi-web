import { useEffect, useRef, useState } from 'react';
import type { ThemedToken } from 'shiki';

const languages: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', vue: 'vue', svelte: 'svelte',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml', css: 'css', scss: 'scss', less: 'less',
  json: 'json', jsonc: 'jsonc', yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini',
  sql: 'sql', sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript', ps1: 'powershell',
  md: 'markdown', mdx: 'mdx', graphql: 'graphql', gql: 'graphql', diff: 'diff', patch: 'diff',
};

export function FileCodePreview({ path, content, line }: { path: string; content: string; line?: number }) {
  const [highlight, setHighlight] = useState<{ path: string; content: string; tokens: ThemedToken[][] } | null>(null);
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    let active = true;
    const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
    const language = name === 'dockerfile' ? 'dockerfile' : name === 'makefile' ? 'makefile' : languages[name.split('.').pop() ?? ''];
    setHighlight(null);
    if (language) void import('shiki').then(async ({ codeToTokens, bundledLanguages }) => {
      if (!active || !(language in bundledLanguages)) return;
      const result = await codeToTokens(content, { lang: language as keyof typeof bundledLanguages, theme: 'github-light' });
      if (active) setHighlight({ path, content, tokens: result.tokens });
    }).catch(() => { /* Keep the complete numbered source when highlighting is unavailable. */ });
    return () => { active = false; };
  }, [path, content]);
  useEffect(() => {
    if (line) ref.current?.querySelector(`[data-line="${line}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [path, content, line]);
  const tokens = highlight?.path === path && highlight.content === content ? highlight.tokens : null;
  const lines = content.split(/\r\n|\n|\r/);
  const gutterWidth = `${Math.max(3, String(lines.length).length)}ch`;
  return <pre ref={ref} className="file-preview-column__content" style={{ whiteSpace: 'pre', overflowWrap: 'normal' }} aria-label="带行号的文件内容"><code className="block min-w-max">{lines.map((text, index) => <span className={`flex min-h-5 ${index + 1 === line ? 'bg-amber-100' : ''}`} data-line={index + 1} key={index}>
    <span aria-hidden="true" className="sticky left-0 mr-4 inline-block shrink-0 select-none border-r border-slate-200 bg-[#f3f6f4] pr-3 text-right text-slate-400" style={{ width: gutterWidth }}>{index + 1}</span>
    <span>{tokens?.[index] ? tokens[index].map((token, i) => <span key={i} style={{ color: token.color, fontStyle: token.fontStyle && token.fontStyle & 1 ? 'italic' : undefined, fontWeight: token.fontStyle && token.fontStyle & 2 ? 'bold' : undefined, textDecoration: token.fontStyle && token.fontStyle & 4 ? 'underline' : undefined }}>{token.content}</span>) : text}</span>
  </span>)}</code></pre>;
}
