"use client";

import { X } from "lucide-react";
import { CodeBlock } from "@/shared/ui/ai-elements/code-block";

export type FilePreview = {
  key: string;
  projectId: string;
  projectName: string;
  path: string;
  content: string;
  size: number;
};

export function FileContentPanel({
  files,
  activeKey,
  onSelect,
  onCloseFile,
  onCloseAll,
}: {
  files: FilePreview[];
  activeKey: string;
  onSelect: (key: string) => void;
  onCloseFile: (key: string) => void;
  onCloseAll: () => void;
}) {
  const file = files.find((item) => item.key === activeKey) ?? files[0];
  if (!file) return null;
  return (
    <aside className="fixed inset-y-0 right-0 z-[60] flex w-[min(440px,calc(100vw-48px))] min-w-0 flex-col border-l border-slate-200 bg-white shadow-2xl shadow-slate-900/10 xl:static xl:z-auto xl:col-start-3 xl:row-start-1 xl:w-auto xl:shadow-none" aria-label="文件内容">
      <header className="flex min-h-[68px] items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="group relative">
          <span className="block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">FILE CONTENT</span>
          <b className="mt-0.5 block text-xs text-slate-800">{file.projectName}</b>
          <small className="mt-1 block max-w-[36vw] truncate font-mono text-[9px] text-slate-500">{file.path} · {file.size} bytes</small>
          <span role="tooltip" className="pointer-events-none absolute left-0 top-full z-[120] mt-2 max-w-[min(36vw,28rem)] rounded-md bg-slate-900 px-2 py-1 text-[10px] leading-4 text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">{file.path}</span>
        </div>
        <button className="grid size-[34px] place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="关闭所有文件内容" onClick={onCloseAll}>
          <X size={16} />
        </button>
      </header>
      <div className="flex min-h-10 shrink-0 items-end gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="已打开文件">
        {files.map((item) => <div key={item.key} className={`group relative flex min-w-0 max-w-52 items-center gap-1 rounded-t-lg border border-b-0 px-2 py-1.5 text-[11px] ${item.key === file.key ? "border-slate-200 bg-white text-slate-800" : "border-transparent text-slate-500 hover:bg-slate-100"}`}><button type="button" role="tab" aria-selected={item.key === file.key} aria-label={`打开 ${item.path}`} className="min-w-0 flex-1 truncate text-left" onClick={() => onSelect(item.key)}>{item.path}</button><button type="button" className="grid size-4 shrink-0 place-items-center rounded text-slate-400 opacity-0 hover:bg-slate-200 group-hover:opacity-100 focus:opacity-100" aria-label={`关闭 ${item.path}`} onClick={() => onCloseFile(item.key)}><X size={11} /></button><span role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-[120] mt-2 w-max max-w-80 -translate-x-1/2 rounded-md bg-slate-900 px-2 py-1 text-[10px] leading-4 text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">{item.path}</span></div>)}
      </div>
      <CodeBlock className="m-0 flex-1 overflow-auto rounded-none border-0 bg-slate-50 p-4" code={file.content} />
    </aside>
  );
}
