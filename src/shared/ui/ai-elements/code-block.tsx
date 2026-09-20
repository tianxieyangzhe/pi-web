"use client";

import { cn } from "@/shared/lib/cn";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Highlighter } from "shiki";

const commonLangs = [
  "typescript", "javascript", "python", "jsx", "tsx",
  "css", "html", "json", "yaml", "markdown", "bash", "shell",
  "sql", "rust", "go", "java", "cpp", "c", "ruby", "php",
  "diff", "dockerfile", "graphql", "xml",
];

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const shiki = await import("shiki");
      return shiki.createHighlighter({
        themes: ["github-dark", "github-light"],
        langs: commonLangs,
      });
    })();
  }
  return highlighterPromise;
}

export function CodeBlock({
  code,
  language,
  className,
}: {
  code: string;
  language?: string;
  className?: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const darkRef = useRef<MediaQueryList | null>(null);

  const applyHighlight = useCallback(async (lang: string, isDark: boolean) => {
    try {
      const highlighter = await getHighlighter();
      const theme = isDark ? "github-dark" : "github-light";
      const normalized = lang === "sh" ? "shell" : lang;
      const result = highlighter.codeToHtml(code, {
        lang: commonLangs.includes(normalized) ? normalized : "text",
        theme,
      });
      setHtml(result);
    } catch {
      setHtml(null);
    }
  }, [code]);

  useEffect(() => {
    darkRef.current = window.matchMedia("(prefers-color-scheme: dark)");

    const handler = () => {
      if (darkRef.current) void applyHighlight(language || "", darkRef.current.matches);
    };

    void applyHighlight(language || "", darkRef.current?.matches ?? true);

    darkRef.current?.addEventListener("change", handler);
    return () => darkRef.current?.removeEventListener("change", handler);
  }, [language, applyHighlight]);

  if (html) {
    return (
      <div
        className={cn("my-3 max-w-full overflow-auto rounded-lg border border-slate-200 text-[11px] leading-6 [&_pre]:m-0 [&_pre]:p-3", className)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <pre className={cn("my-3 max-w-full overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-3 font-mono text-[11px] leading-6 text-slate-100", className)} data-language={language || undefined}>
      <code>{code}</code>
    </pre>
  );
}
