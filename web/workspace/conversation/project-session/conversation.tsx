import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import type { SessionTree } from "../../../domain/models";
import { Response } from "../ai-elements/response";
import { isReferenceEntry, referenceTreeProjection } from "../reference-tree-projection";
import { contentBlocks, temporaryMessage } from "../session-tree-projection";
import type { TemporaryNode } from "../use-session-tree";

const rawClass = "m-0 max-w-full overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-zinc-400 [overflow-wrap:anywhere]";
function Raw({ value }: { value: unknown }) { return <pre className={rawClass}>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>; }
function Disclosure({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return <details open={open || undefined} className="min-w-0 text-[10px] leading-4 text-zinc-400"><summary className="w-fit cursor-pointer focus-visible:outline-2">{title}</summary><div className="grid min-w-0 gap-1 pt-1">{children}</div></details>;
}
function MessageContent({ message }: { message: Record<string, unknown> }) {
  return <div className="grid min-w-0 gap-1 text-sm leading-6 text-zinc-800 [overflow-wrap:anywhere]">
    {contentBlocks(message.content).map((block, index) => {
      if (block.type === "text") return <Response key={index} className="gap-2! leading-6">{block.text ?? ""}</Response>;
      if (block.type === "thinking") return <Disclosure key={index} title="Thinking"><div className="whitespace-pre-wrap text-[10px] leading-4">{block.thinking ?? ""}</div></Disclosure>;
      if (block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string" && ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(block.mimeType)) return <Disclosure key={index} title="图片内容"><img src={`data:${block.mimeType};base64,${block.data}`} alt="本轮参考图片" className="max-h-80 max-w-full object-contain" /><Disclosure title="完整图片节点"><Raw value={block} /></Disclosure></Disclosure>;
      if (block.type === "toolCall") return <Disclosure key={index} title={`工具调用 · ${block.name ?? "tool"}`}><Raw value={block.arguments} /></Disclosure>;
      return <Disclosure key={index} title={block.type === "image" ? "图片内容" : `内容 · ${block.type}`}><Raw value={block} /></Disclosure>;
    })}
    {message.errorMessage != null && <p className="m-0 text-sm text-red-700" role="alert">{String(message.errorMessage)}</p>}
  </div>;
}
function ReferenceEntry({ entry }: { entry: SessionTree["entries"][number]["entry"] }) {
  return <div data-entry-id={entry.id}><Disclosure title="本轮附件"><MessageContent message={{content:entry.content}} /><Disclosure title="完整原生节点"><Raw value={entry} /></Disclosure></Disclosure></div>;
}
export function Conversation({ tree, temporary, pendingText, running, afterTurns }: { tree: SessionTree; temporary: TemporaryNode[]; pendingText: string; running: boolean; afterTurns?: Map<string, ReactNode> }) {
  const entries = new Map(tree.entries.map(({ entry }) => [entry.id, entry]));
  const visibleTemporary = temporary.filter(item => !item.entryId || !entries.has(item.entryId));
  const projection = referenceTreeProjection(tree);
  return <section className="flex min-w-0 flex-col gap-1" aria-label="Pi Session Tree 对话流">
    {projection.items.map(({ entry }) => {
      const message = entry.message as Record<string, unknown> | undefined;
      const role = String(message?.role ?? entry.type), user = role === "user", tool = role === "toolResult";
      return <div key={entry.id} data-entry-id={entry.id} className="grid min-w-0 gap-1">
        <article className={`grid min-w-0 gap-1 ${user ? "ml-auto w-3/4 rounded-lg bg-emerald-50/70 px-3 py-2 text-left" : "p-0"}`}>
          {message ? tool ? <Disclosure title={message.isError ? "工具执行失败 · 查看完整结果" : "查看完整工具结果"}><Raw value={message} /></Disclosure> : <MessageContent message={message} /> : isReferenceEntry(entry) ? <ReferenceEntry entry={entry} /> : <Disclosure title={`原生节点 · ${entry.type}`}><Raw value={entry} /></Disclosure>}
          {projection.attachments.get(entry.id)?.map(item => <ReferenceEntry key={item.entry.id} entry={item.entry} />)}
        </article>
        {afterTurns?.get(entry.id)}
      </div>;
    })}
    {pendingText && <article className="ml-auto grid w-3/4 min-w-0 gap-1 rounded-lg bg-emerald-50/70 px-3 py-2 text-left"><span className="text-[11px] text-zinc-500">你 · 等待原生输入事件确认</span><div className="whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">{pendingText}</div></article>}
    {visibleTemporary.map(item => {
      const message = temporaryMessage(item);
      if (message?.role === "custom" && message.customType === "user_reference_files") return <Disclosure key={item.key} title="本轮附件 · 同步中"><MessageContent message={message} /><Disclosure title="完整实时事件"><Raw value={item.events} /></Disclosure></Disclosure>;
      const toolEvents = item.events.filter(event => event.type.startsWith("tool_execution_"));
      const tool = toolEvents.length ? Object.assign({}, ...toolEvents.map(event => event.payload)) as Record<string, unknown> : null;
      return <article className={`grid min-w-0 gap-1 ${message?.role==='user'?'ml-auto w-3/4 rounded-lg bg-emerald-50/70 px-3 py-2 text-left':''}`} key={item.key}><span className="text-[11px] text-zinc-500">{String(message?.role ?? "Pi")} · {item.entryId ? "等待历史核对" : "未确认持久化"}</span>{message ? <MessageContent message={message} /> : tool ? <Disclosure title={`工具 · ${String(tool.toolName ?? "tool")} · ${toolEvents.at(-1)?.type === "tool_execution_end" ? "已返回" : "执行中"}`}><Raw value={tool.args} />{tool.result != null || tool.partialResult != null ? <Raw value={tool.result ?? tool.partialResult} /> : null}<Disclosure title="完整工具事件"><Raw value={item.events} /></Disclosure></Disclosure> : <Disclosure title="实时事件"><Raw value={item.events} /></Disclosure>}</article>;
    })}
    {running && <p className="m-0 flex items-center gap-2 py-1 text-xs text-zinc-500" role="status"><LoaderCircle className="animate-spin" size={14} aria-hidden="true" />正在等待</p>}
  </section>;
}
