import { useEffect, useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import type { SessionTree } from "../../../domain/models";
import { Response } from "../ai-elements/response";
import { isReferenceEntry, referenceTreeProjection } from "../reference-tree-projection";
import { contentBlocks, temporaryMessage } from "../session-tree-projection";
import type { TemporaryNode } from "../use-session-tree";
import type { SessionRunMetrics, SessionTokenUsage } from "../../../../src/domain/session-run-metrics";

const rawClass = "m-0 max-w-full overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-zinc-400 [overflow-wrap:anywhere]";
function Raw({ value }: { value: unknown }) { return <pre className={rawClass}>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>; }
function Disclosure({ title, children, open = false, onOpenChange }: { title: string; children: ReactNode; open?: boolean; onOpenChange?:(open:boolean)=>void }) {
  return <details open={onOpenChange ? open : open || undefined} onToggle={event=>{if(event.target===event.currentTarget)onOpenChange?.(event.currentTarget.open);}} className="min-w-0 text-[10px] leading-4 text-zinc-400"><summary className="w-fit cursor-pointer focus-visible:outline-2">{title}</summary><div className="grid min-w-0 gap-1 pt-1">{children}</div></details>;
}
function emptyAssistant(message:Record<string,unknown>) {
  return message.role==='assistant'&&message.errorMessage==null&&contentBlocks(message.content).every(block=>block.type==='text'&&typeof block.text==='string'&&!block.text.trim());
}
function MessageContent({ message }: { message: Record<string, unknown> }) {
  if(emptyAssistant(message))return <Disclosure title="该回复节点没有正文"><Raw value={message}/></Disclosure>;
  return <div className="grid min-w-0 gap-1 text-sm leading-6 text-zinc-800 [overflow-wrap:anywhere]">
    {contentBlocks(message.content).map((block, index) => {
      if (block.type === "text") return <Response key={index} className="gap-2! leading-6">{block.text ?? ""}</Response>;
      if (block.type === "thinking") return <Disclosure key={index} title="Thinking">
        <div className="whitespace-pre-wrap text-[10px] leading-4">{typeof block.thinking === "string" && block.thinking.trim() ? block.thinking : "该节点未包含可显示的思考正文。"}</div>
        <Disclosure title="完整原始思考节点"><Raw value={block} /></Disclosure>
      </Disclosure>;
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
function WaitingIndicator({running,metrics,tokenUsage,latestRunUsage}:{running:boolean;metrics?:SessionRunMetrics|null;tokenUsage?:SessionTokenUsage;latestRunUsage?:SessionTokenUsage|null}) {
  const [seconds,setSeconds]=useState<number|null>(null);
  useEffect(()=>{
    if(!running)return;
    const since=performance.now();
    const update=()=>setSeconds(metrics?Math.max(0,Math.floor((metrics.durationMs+performance.now()-since)/1000)):null);
    update();const timer=setInterval(update,1000);
    return()=>{clearInterval(timer);update();};
  },[running,metrics]);
  if(!running&&!metrics&&!tokenUsage&&!latestRunUsage)return null;
  const elapsed=metrics?(running?seconds:Math.floor(metrics.durationMs/1000)):null;
  const usage=metrics?.totalTokens!=null?metrics:running&&metrics?metrics:latestRunUsage??metrics;
  const tokens=usage?.totalTokens;
  const tokenLabel=tokens==null?'本轮Token不可用':`${running?'本轮已报告':'本轮消耗'} ${tokens.toLocaleString()} tokens${!running&&!usage?.complete?'（仅供参考）':''}`;
  const duration=elapsed??0;
  const time=elapsed===null?'耗时不可用':duration>=3600?`${Math.floor(duration/3600)}:${String(Math.floor(duration/60)%60).padStart(2,'0')}:${String(duration%60).padStart(2,'0')}`:`${Math.floor(duration/60)}:${String(duration%60).padStart(2,'0')}`;
  return <p className="m-0 flex flex-wrap items-center gap-2 py-1 text-xs text-zinc-500" role="status">
    {running&&<><LoaderCircle className="animate-spin" size={14} aria-hidden="true"/>正在等待</>}
    <span className="tabular-nums">{tokenLabel}</span>
    <span className="tabular-nums" aria-live="off">· {elapsed===null?'耗时不可用':`耗时 ${time}`}</span>
    {tokenUsage&&<span className="tabular-nums">· 会话累计 {tokenUsage.totalTokens==null?"不可用":`${tokenUsage.totalTokens.toLocaleString()} tokens`}{tokenUsage.complete?"":"（仅供参考）"}</span>}
  </p>;
}
export function Conversation({ tree, temporary, steeringQueue = [], pendingText, running, runMetrics, afterTurns }: { runMetrics?:SessionRunMetrics|null; tree: SessionTree; steeringQueue?:string[]; temporary: TemporaryNode[]; pendingText: string; running: boolean; afterTurns?: Map<string, ReactNode> }) {
  const [expandedTools,setExpandedTools]=useState<Set<string>>(()=>new Set());
  const [expandedGroups,setExpandedGroups]=useState<Set<string>>(()=>new Set());
  const entries = new Map(tree.entries.map(({ entry }) => [entry.id, entry]));
  const visibleTemporary = temporary.filter(item => !item.entryId || !entries.has(item.entryId));
  const resultToolIds=new Set([...tree.entries.map(({entry})=>entry.message),...visibleTemporary.map(temporaryMessage)]
    .flatMap(value=>{const message=value as Record<string,unknown>|null|undefined;return message?.role==='toolResult'&&typeof message.toolCallId==='string'?[message.toolCallId]:[];}));
  function toolDisclosure(value:Record<string,unknown>,fallbackKey:string,complete:boolean,events?:TemporaryNode['events']) {
    const key=typeof value.toolCallId==='string'?`tool:${value.toolCallId}`:fallbackKey;
    const title=`工具 · ${String(value.toolName??"tool")} · ${value.isError?"执行失败":complete?"已返回":"执行中"}`;
    return <Disclosure title={title} open={expandedTools.has(key)} onOpenChange={open=>setExpandedTools(current=>{
      if(current.has(key)===open)return current;
      const next=new Set(current);if(open)next.add(key);else next.delete(key);return next;
    })}><Raw value={value}/>{events&&<Disclosure title="完整工具事件"><Raw value={events}/></Disclosure>}</Disclosure>;
  }
  const projection = referenceTreeProjection(tree);
  type Row={key:string;content:ReactNode;calls:Map<string,string>;returned:Set<string>;failed:boolean;entryId?:string;parentId?:string|null;runId?:string|null};
  const rows:Row[]=[],childCounts=new Map<string,number>();
  for(const {entry} of tree.entries)if(entry.parentId)childCounts.set(entry.parentId,(childCounts.get(entry.parentId)??0)+1);
  function activity(message:Record<string,unknown>|null|undefined,fallback:string) {
    const calls=new Map<string,string>(),returned=new Set<string>();
    // Progress prose remains visible even when the same message also calls tools.
    if(message?.role==='assistant'&&(contentBlocks(message.content).some(block=>block.type==='text'&&typeof block.text==='string'&&block.text.trim())||message.errorMessage!=null))return {calls,returned,failed:false};
    if(message?.role==='assistant')for(const block of contentBlocks(message.content))if(block.type==='toolCall'&&typeof block.id==='string'&&block.id)calls.set(block.id,block.name??'tool');
    if(message?.role==='toolResult'){const id=typeof message.toolCallId==='string'?message.toolCallId:fallback;calls.set(id,String(message.toolName??'tool'));returned.add(id);}
    return {calls,returned,failed:message?.role==='toolResult'&&!!message.isError};
  }
  for(const {entry} of projection.items) {
      const message = entry.message as Record<string, unknown> | undefined;
      const role = String(message?.role ?? entry.type), user = role === "user", tool = role === "toolResult";
      const content=<div key={entry.id} data-entry-id={entry.id} className="grid min-w-0 gap-1">
        <article className={`grid min-w-0 gap-1 ${user ? "ml-auto w-3/4 rounded-lg bg-sky-100 px-3 py-2 text-left" : "p-0"}`}>
          {message ? tool ? toolDisclosure(message,`entry:${entry.id}`,true) : <MessageContent message={message} /> : isReferenceEntry(entry) ? <ReferenceEntry entry={entry} /> : <Disclosure title={`原生节点 · ${entry.type}`}><Raw value={entry} /></Disclosure>}
          {projection.attachments.get(entry.id)?.map(item => <ReferenceEntry key={item.entry.id} entry={item.entry} />)}
        </article>
        {afterTurns?.get(entry.id)}
      </div>;
      rows.push({key:entry.id,content,...activity(message,entry.id),entryId:entry.id,parentId:entry.parentId});
    }
    if(pendingText)rows.push({key:'pending-input',calls:new Map(),returned:new Set(),failed:false,content:<article className="ml-auto grid w-3/4 min-w-0 gap-1 rounded-lg bg-sky-100 px-3 py-2 text-left"><span className="text-[11px] text-zinc-500">你 · 等待原生输入事件确认</span><div className="whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">{pendingText}</div></article>});
    for(const item of visibleTemporary) {
      const message = temporaryMessage(item);
      if(message&&emptyAssistant(message)&&!item.events.some(event=>event.type==='message_end'))continue;
      if (message?.role === "custom" && message.customType === "user_reference_files") {rows.push({key:item.key,calls:new Map(),returned:new Set(),failed:false,content:<Disclosure key={item.key} title="本轮附件 · 同步中"><MessageContent message={message} /><Disclosure title="完整实时事件"><Raw value={item.events} /></Disclosure></Disclosure>});continue;}
      const toolEvents = item.events.filter(event => event.type.startsWith("tool_execution_"));
      const tool = toolEvents.length ? Object.assign({}, ...toolEvents.map(event => event.payload)) as Record<string, unknown> : null;
      if(!message&&tool&&typeof tool.toolCallId==='string'&&resultToolIds.has(tool.toolCallId))continue;
      const fallbackKey=item.entryId?`entry:${item.entryId}`:`temporary:${item.key}`;
      const content=<article className={`grid min-w-0 gap-1 ${message?.role==='user'?'ml-auto w-3/4 rounded-lg bg-sky-100 px-3 py-2 text-left':''}`} key={item.key}><span className="text-[11px] text-zinc-500">{String(message?.role ?? "Pi")} · {item.entryId ? "等待历史核对" : "未确认持久化"}</span>{message ? message.role==='toolResult'?toolDisclosure(message,fallbackKey,true):<MessageContent message={message} /> : tool ? toolDisclosure(tool,fallbackKey,toolEvents.at(-1)?.type==='tool_execution_end',item.events) : <Disclosure title="实时事件"><Raw value={item.events} /></Disclosure>}</article>;
      const details=activity(message,fallbackKey);
      if(!message&&tool&&typeof tool.toolCallId==='string'){details.calls.set(tool.toolCallId,String(tool.toolName??'tool'));if(toolEvents.at(-1)?.type==='tool_execution_end')details.returned.add(tool.toolCallId);details.failed=!!tool.isError;}
      rows.push({key:item.key,content,...details,entryId:item.entryId??undefined,runId:item.events.find(event=>event.runId)?.runId});
    }
    const groups:Array<{rows:Row[];calls:Map<string,string>;returned:Set<string>;failed:boolean}>=[];
    for(const row of rows){
      const previous=groups.at(-1),last=previous?.rows.at(-1);
      const continuous=previous&&last&&last.calls.size>0&&row.calls.size>0;
      const sameBranch=!(last?.entryId&&row.parentId!==undefined)||row.parentId===last.entryId;
      const beforeFork=last?.entryId&&(childCounts.get(last.entryId)??0)>1;
      const sameRun=!last?.runId||!row.runId||last.runId===row.runId;
      if(continuous&&sameBranch&&!beforeFork&&sameRun){previous.rows.push(row);for(const [id,name] of row.calls)previous.calls.set(id,name);for(const id of row.returned)previous.returned.add(id);previous.failed ||= row.failed;}
      else groups.push({rows:[row],calls:new Map(row.calls),returned:new Set(row.returned),failed:row.failed});
    }
  return <section className="flex min-w-0 flex-col gap-1" aria-label="Pi Session Tree 对话流">
    {groups.map(group=>{
      if(group.calls.size<2)return group.rows.map(row=><div className="min-w-0" key={row.key}>{row.content}</div>);
      const key=`tools:${group.calls.keys().next().value}`,names=[...new Set(group.calls.values())],pending=[...group.calls.keys()].some(id=>!group.returned.has(id));
      const title=`工具调用 · ${group.calls.size} 次 · ${names.slice(0,3).join('、')}${names.length>3?' 等':''}${group.failed?' · 有失败':''}${pending&&running&&group===groups.at(-1)?' · 执行中':''}`;
      return <Disclosure key={key} title={title} open={expandedGroups.has(key)} onOpenChange={open=>setExpandedGroups(current=>{if(current.has(key)===open)return current;const next=new Set(current);if(open)next.add(key);else next.delete(key);return next;})}>{group.rows.map(row=><div className="min-w-0" key={row.key}>{row.content}</div>)}</Disclosure>;
    })}
    {steeringQueue.map((text,index)=><article key={index} className="ml-auto w-3/4 rounded-lg bg-sky-100 px-3 py-2"><span className="text-[11px] text-zinc-500">纠正 · 等待 Pi 消费</span><div className="whitespace-pre-wrap text-sm">{text}</div></article>)}
    <WaitingIndicator running={running} metrics={runMetrics} tokenUsage={tree.tokenUsage} latestRunUsage={tree.latestRunUsage}/>
  </section>;
}
