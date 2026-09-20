"use client";

import type { ActivityEvent, ConversationMessage, Room, RoomContent, Session } from "@/domain/models";
import type { RoomContentCandidate } from "@/features/room/room-dialogs";
import { MarkdownResponse } from "@/shared/ui/ai-elements/markdown-response";
import { ArrowUp, Bot, BrainCircuit, Check, CircleAlert, CircleStop, LoaderCircle, Menu, PanelRightClose, PanelRightOpen, Pencil, Plus, RotateCcw, Settings2, Square, User, Wrench } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

type RoomSurfaceProps = {
  room: Room | null;
  sessions: Session[];
  contents: RoomContent[];
  messages: ConversationMessage[];
  streamingText: string;
  activities: ActivityEvent[];
  candidates: Array<{ id: string; candidate: RoomContentCandidate }>;
  activeSessionId: string | null;
  inspectorVisible: boolean;
  onSessionSelect: (session: Session) => void;
  onCreateSession: () => void;
  onSend: (content: string) => void;
  onInterrupt: () => void;
  onConfigureSession: () => void;
  onRestoreSession: () => void;
  onEndSession: () => void;
  onAdoptCandidate: (id: string, candidate: RoomContentCandidate) => void;
  onEditCandidate: (id: string, candidate: RoomContentCandidate) => void;
  onDismissCandidate: (id: string) => void;
  onEditRoom: () => void;
  onToggleSidebar: () => void;
  onToggleInspector: () => void;
};

export function RoomSurface({ room, sessions, contents, messages, streamingText, activities, candidates, activeSessionId, inspectorVisible, onSessionSelect, onCreateSession, onSend, onInterrupt, onConfigureSession, onRestoreSession, onEndSession, onAdoptCandidate, onEditCandidate, onDismissCandidate, onEditRoom, onToggleSidebar, onToggleInspector }: RoomSurfaceProps) {
  const [draft, setDraft] = useState("");
  const timelineRef = useRef<HTMLDivElement>(null);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions.find((session) => session.role === "primary") ?? null;
  const running = activeSession?.state === "running" || activeSession?.state === "starting";
  const goal = contents.find((item) => item.kind === "goal" && item.status === "active");
  const directions = contents.filter((item) => item.kind === "direction" && item.status !== "dismissed");
  const outputs = contents.filter((item) => item.kind === "output" && item.status === "published");
  const runtimeStatus = activities.find((activity) =>
    activity.id === "runtime-starting" || activity.id === "runtime-waiting",
  );
  const draftKey = room ? `ai-workspace:draft:${room.id}:${activeSession?.id ?? "primary"}` : null;

  useEffect(() => {
    setDraft(draftKey ? window.localStorage.getItem(draftKey) ?? "" : "");
  }, [draftKey]);

  useEffect(() => {
    const node = timelineRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, streamingText, activities.length]);

  function submit() {
    const value = draft.trim();
    if (!value || running) return;
    setDraft("");
    if (draftKey) window.localStorage.removeItem(draftKey);
    onSend(value);
  }

  function moveSessionFocus(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || target.getAttribute("role") !== "tab") return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="tab"]')];
    const current = tabs.indexOf(target);
    if (current < 0) return;
    event.preventDefault();
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].click();
  }

  return <main className="col-start-1 flex min-w-0 min-h-0 flex-col bg-slate-50 md:col-start-2">
    <header className="flex min-h-[108px] items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-5 sm:px-7">
      <button className="mt-0.5 grid size-[34px] shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 md:hidden" aria-label="显示工作空间导航" onClick={onToggleSidebar}><Menu size={18} /></button><div className="min-w-0 flex-1"><span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">ROOM / {room?.status ?? "未选择"}</span><h1 className="my-1 mb-3 truncate text-2xl font-bold tracking-tight text-slate-900">{room?.title ?? "选择一个会话"}</h1><div className="flex flex-wrap gap-2 text-[11px] text-slate-500"><span className="max-w-[360px] truncate rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">目标：{goal?.body ?? "尚未形成"}</span><span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">方向：{directions.length}</span><span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">输出：{outputs.length}</span><span className="max-w-[300px] truncate rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">当前工作线：{activeSession ? `${activeSession.agentSnapshot?.name ?? "Pi 基础能力"} · ${activeSession.state}` : "尚未开始"}</span></div></div>
      <div className="flex gap-1.5 pt-0.5">{room && <button className="grid size-[34px] place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="修改会话" title="修改会话" onClick={onEditRoom}><Pencil size={16} /></button>}{activeSession && activeSession.state !== "ended" && <button className="grid size-[34px] place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="配置当前工作线" title="配置当前工作线" onClick={onConfigureSession}><Settings2 size={17} /></button>}{activeSession?.state === "unavailable" && <button className="grid size-[34px] place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="恢复当前工作线" title="恢复当前工作线" onClick={onRestoreSession}><RotateCcw size={16} /></button>}{activeSession && ["not_started", "idle", "unavailable"].includes(activeSession.state) && <button className="grid size-[34px] place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="结束当前工作线" title="结束当前工作线" onClick={onEndSession}><CircleStop size={16} /></button>}<button className="grid size-[34px] place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label={inspectorVisible ? "隐藏检查栏" : "显示检查栏"} aria-pressed={inspectorVisible} title={inspectorVisible ? "隐藏检查栏" : "显示检查栏"} onClick={onToggleInspector}>{inspectorVisible ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button></div>
    </header>
    <div className="flex min-h-[62px] items-center gap-2 overflow-x-auto border-b border-slate-200 bg-white px-5 py-2.5" role="tablist" aria-label="工作线" onKeyDown={moveSessionFocus}>
      {sessions.filter((session) => session.role === "primary").map((session) => <SessionTab key={session.id} session={session} active={session.id === activeSession?.id} onClick={() => onSessionSelect(session)} />)}
      {sessions.filter((session) => session.role === "worker").map((session) => <SessionTab key={session.id} session={session} active={session.id === activeSession?.id} onClick={() => onSessionSelect(session)} />)}
      {sessions.length === 0 && <div className="flex min-w-max items-center gap-1.5 text-[11px] text-slate-500"><Bot size={15} />主工作线尚未开始</div>}
      <button className="ml-1 inline-flex min-h-9 min-w-max items-center gap-1.5 rounded-lg border border-dashed border-teal-300 bg-teal-50 px-2.5 text-[11px] font-bold text-teal-700 hover:bg-teal-100" onClick={onCreateSession}><Plus size={15} />新建辅助工作线</button>
    </div>
    <div className="flex-1 overflow-auto bg-slate-50 px-7 py-8" ref={timelineRef}>
      <div className="mx-auto max-w-[880px]">{!room ? <EmptyState title="选择一个会话" body="从左侧选择会话，或创建一个新的会话。" /> : sessions.length === 0 && messages.length === 0 && !streamingText ? <EmptyState title="从任何想法开始" body="你可以直接发送消息，让 Pi 帮你探索方向；也可以先创建带有 Agent、MCP 和项目的工作线。" /> : <>
          {runtimeStatus && <span className="sr-only" role="status">{runtimeStatus.summary}</span>}
          {streamingText && <span className="sr-only" role="status">Pi 正在生成回复</span>}
        {messages.map((message) => <Message key={message.id} message={message} />)}
        {(activities.length > 0 || streamingText) && <article className="mb-5 border-l-4 border-slate-200 bg-white/60 py-1 pl-3">
          {activities.length > 0 && <div className="mb-2 grid gap-1.5" aria-label="当前工作活动">{activities.map((activity) => <Activity key={activity.id} activity={activity} />)}</div>}
          {streamingText && <Message message={{ id: "streaming", sessionId: activeSession?.id ?? "", role: "assistant", content: streamingText, createdAt: new Date().toISOString() }} streaming />}
        </article>}
      </>}
      {candidates.map((item) => <CandidateCard key={item.id} candidate={item.candidate} onAdopt={() => onAdoptCandidate(item.id, item.candidate)} onEdit={() => onEditCandidate(item.id, item.candidate)} onDismiss={() => onDismissCandidate(item.id)} />)}</div>
    </div>
    <form className="mx-auto mb-6 w-[min(960px,calc(100%-48px))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 focus-within:border-teal-400 focus-within:ring-4 focus-within:ring-teal-100" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <textarea className="block min-h-[66px] w-full resize-none border-0 bg-transparent px-4 py-3.5 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400" value={draft} onChange={(event) => { setDraft(event.target.value); if (draftKey) window.localStorage.setItem(draftKey, event.target.value); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} placeholder={activeSession?.state === "ended" ? "该工作线已结束" : activeSession?.state === "unavailable" ? "请先恢复该工作线" : activeSession?.role === "worker" ? `发送给辅助工作线：${activeSession.purpose ?? "未命名"}` : "输入任何想法，开始一个新的方向"} aria-label="消息输入" disabled={!room || running && activeSession?.state === "starting" || activeSession?.state === "ended" || activeSession?.state === "unavailable"} />
      <div className="flex items-center gap-1.5 border-t border-slate-100 px-2.5 py-2 text-[11px] text-slate-500"><span className="min-w-0 flex-1 truncate">{activeSession ? `${activeSession.agentSnapshot?.name ?? "Pi 基础能力"} · ${activeSession.workingProjectId ? "项目工作" : "无工作项目"}` : "第一条消息将创建主工作线"}</span><button type="button" className="grid size-8 place-items-center rounded-lg bg-orange-100 text-orange-800 disabled:opacity-35" onClick={onInterrupt} disabled={!running} aria-label="停止工作线" title="停止工作线"><Square size={14} fill="currentColor" /></button><button className="grid size-8 place-items-center rounded-lg bg-teal-700 text-white disabled:opacity-35" type="submit" disabled={!draft.trim() || running || activeSession?.state === "ended" || activeSession?.state === "unavailable"}><ArrowUp size={15} /></button></div>
    </form>
  </main>;
}

function SessionTab({ session, active, onClick }: { session: Session; active: boolean; onClick: () => void }) {
  return <button role="tab" aria-selected={active} tabIndex={active ? 0 : -1} className={`flex h-[42px] min-w-[182px] items-center gap-2 rounded-xl border px-3 text-left shadow-sm transition ${active ? "border-teal-400 bg-teal-50 ring-2 ring-teal-100" : "border-slate-200 bg-white hover:border-teal-200 hover:bg-teal-50/50"}`} onClick={onClick}><span className={`size-2 shrink-0 rounded-full ${session.state === "running" || session.state === "starting" ? "bg-teal-600 ring-4 ring-teal-100" : session.state === "unavailable" ? "bg-amber-600" : session.state === "ended" ? "bg-slate-500" : "bg-slate-400"}`} /><span className="min-w-0"><b className="block truncate text-xs text-slate-800">{session.role === "primary" ? "主工作线" : session.purpose || "辅助工作线"}</b><small className="mt-0.5 block truncate text-[10px] text-slate-500">{session.agentSnapshot?.name ?? "Pi 基础能力"}{session.workingProjectId ? " · 项目" : ""}</small></span></button>;
}

function EmptyState({ title, body }: { title: string; body: string }) { return <div className="mx-auto mt-[14vh] max-w-[410px] rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-500 shadow-xl shadow-slate-900/5"><Bot className="mx-auto text-teal-700" size={31} strokeWidth={1.5} /><h2 className="mt-3 text-xl font-bold text-slate-800">{title}</h2><p className="mt-2 text-xs leading-6">{body}</p></div>; }

function Message({ message, streaming = false }: { message: ConversationMessage; streaming?: boolean }) {
  return <article className={`mb-5 max-w-[880px] border p-3.5 shadow-sm ${message.role === "user" ? "ml-auto max-w-[700px] rounded-2xl rounded-br bg-teal-50 border-teal-200" : "rounded-2xl rounded-bl border-slate-200 bg-white"} ${streaming ? "border-l-4 border-l-teal-600" : ""}`}><div className="mb-2 flex items-center gap-1.5 text-[11px] text-slate-500">{message.role === "user" ? <User size={13} /> : <Bot size={13} />}<span>{message.role === "user" ? "你" : "Pi"}</span><time className="ml-auto">{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>{streaming && <LoaderCircle className="animate-spin" size={13} />}</div><div className="min-w-0 break-words text-sm leading-7 text-slate-700">{message.role === "assistant" && message.thinking && <details className="mb-3 rounded-lg border border-slate-200 bg-slate-50"><summary className="flex min-h-8 cursor-pointer items-center gap-1.5 px-2.5 text-[11px] text-slate-600"><BrainCircuit size={13} />思考过程</summary><div className="max-h-64 overflow-auto border-t border-slate-200 p-2.5 text-[11px] leading-6 text-slate-600 whitespace-pre-wrap">{message.thinking}</div></details>}{message.role === "assistant" && message.toolResults && <details className="mb-3 rounded-lg border border-amber-200 bg-amber-50"><summary className="flex min-h-8 cursor-pointer items-center gap-1.5 px-2.5 text-[11px] text-amber-900"><Wrench size={13} />执行过程</summary><ToolResultsDisplay data={message.toolResults} /></details>}<MarkdownResponse streaming={streaming}>{message.content}</MarkdownResponse></div></article>;
}

function Activity({ activity }: { activity: ActivityEvent }) {
  const Icon = activity.state === "running" ? LoaderCircle : activity.state === "completed" ? Check : CircleAlert;
  const SecondaryIcon = activity.kind === "thinking" ? BrainCircuit : Wrench;
  return <details className="rounded-lg border border-slate-200 bg-white"><summary className="flex min-h-8 cursor-pointer items-center gap-1.5 px-2.5 text-[11px] text-slate-600"><Icon className={activity.state === "running" ? "animate-spin" : ""} size={13} /><SecondaryIcon size={12} /><span className="min-w-0 flex-1 truncate">{activity.kind === "thinking" ? "思考过程" : activity.summary}</span></summary>{activity.detail && <pre className="max-h-56 overflow-auto border-t border-slate-200 p-2.5 text-[10px] leading-5 whitespace-pre-wrap text-slate-600">{activity.detail}</pre>}</details>;
}

function ToolResultsDisplay({ data }: { data: string }) {
  interface ToolEntry { tool: string; detail: string }
  let entries: ToolEntry[] = [];
  try { entries = JSON.parse(data); } catch {}
  if (!entries.length) return <pre className="p-2.5 text-[10px] whitespace-pre-wrap text-amber-950">{data}</pre>;
  return <div>{entries.map((entry, i) => {
    let display = entry.detail;
    try {
      const parsed = JSON.parse(entry.detail);
      if (Array.isArray(parsed)) {
        display = parsed.map((item, idx) => `[${idx}] ${String(item).substring(0, 300)}`).join("\n");
      } else if (typeof parsed === "object" && parsed !== null) {
        display = Object.entries(parsed)
          .filter(([k]) => isNaN(Number(k)))
          .map(([k, v]) => `${k}: ${String(v).substring(0, 300)}`)
          .join("\n");
      } else if (typeof parsed === "string") {
        display = parsed.substring(0, 500);
      } else {
        display = JSON.stringify(parsed, null, 2).substring(0, 500);
      }
    } catch {}
    return <details key={i} className="border-t border-amber-200 first:border-t-0"><summary className="flex min-h-8 cursor-pointer items-center gap-1.5 px-2.5 text-[10px] text-amber-900"><Wrench size={11} />{entry.tool}</summary><pre className="overflow-auto border-t border-amber-200 p-2.5 text-[10px] leading-5 whitespace-pre-wrap text-amber-950">{display}</pre></details>;
  })}</div>;
}

function CandidateCard({ candidate, onAdopt, onEdit, onDismiss }: { candidate: RoomContentCandidate; onAdopt: () => void; onEdit: () => void; onDismiss: () => void }) {
  return <article className="mb-4 max-w-[880px] rounded-xl border border-teal-200 bg-teal-50 p-3"><span className="text-[10px] font-bold text-teal-700">{candidate.kind === "goal" ? "目标候选" : candidate.kind === "direction" ? "方向候选" : `${candidate.outputKind ?? "输出"}候选`}</span><h3 className="mt-1 text-sm font-bold text-slate-800">{candidate.title}</h3><p className="mt-1 text-xs leading-5 whitespace-pre-wrap text-slate-600">{candidate.body}</p><footer className="mt-3 flex justify-end gap-1.5"><button className="min-h-7 rounded-md border border-slate-200 bg-white px-2 text-[10px] text-slate-600" onClick={onDismiss}>忽略</button><button className="min-h-7 rounded-md border border-slate-200 bg-white px-2 text-[10px] text-slate-600" onClick={onEdit}>编辑</button><button className="min-h-7 rounded-md bg-teal-700 px-2 text-[10px] font-bold text-white" onClick={onAdopt}>采用</button></footer></article>;
}
