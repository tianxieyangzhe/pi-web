import type { ReactNode } from "react";
import type { Project } from "../../../domain/models";
import type { BotProjectCall } from "../../../domain/bot";
import type { useBotConversation } from "./use-bot-conversation";
import { Conversation } from "../project-session/conversation";
import { ErrorToast } from "../error-toast";
import { PromptInput } from "../prompt-input";

const callErrors: Record<BotProjectCall["status"], string | null> = {
  accepted: "项目调用尚未开始，没有最终输出",
  working: "项目调用仍在处理，还没有最终输出",
  completed: null,
  aborted: "项目调用已中止，没有可展示的最终输出",
  unknown: "项目调用结果未知，无法确认最终输出",
};

export function BotConversationView({ state, projects }: { state: ReturnType<typeof useBotConversation>; projects: Project[]; onRole?: (id: string) => void; onManage?: () => void; onReviewAgentIssue?: (agentId: string, summary: string) => void }) {
  const detail = state.detail;
  const calls = [...(detail?.calls ?? [])].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const projectName = (id: string) => projects.find(project => project.id === id)?.name ?? detail?.participants.find(participant => participant.projectId === id)?.projectName ?? "项目";
  const cards = new Map<string, ReactNode>();
  for (const [index, call] of calls.entries()) {
    const anchor = state.messages.find(message => message.id === call.sourceEntryId)?.id ?? state.messages.at(-1)?.id;
    if (!anchor) continue;
    const previous = cards.get(anchor);
    const error = call.outputError ?? callErrors[call.status];
    const card = <details className="min-w-0 rounded-md border border-zinc-200 bg-zinc-50/50" key={call.id}>
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-xs text-zinc-600"><span>{projectName(call.projectId)} · 项目输出 {index + 1}</span><span>{call.status}</span></summary>
      <div className="min-w-0 whitespace-pre-wrap border-t border-zinc-200 px-3 py-2 text-sm leading-6">{error ? <p role="alert">{error}</p> : <div className="message__content">{call.output}</div>}</div>
    </details>;
    cards.set(anchor, <>{previous}{card}</>);
  }
  const blockedReason = !state.ready ? "正在连接协调会话…" : !detail ? "正在加载协调会话…" : detail.bot.status !== "active" ? "Bot 已停用。" : detail.conversation.roleState?.available === false ? detail.conversation.roleState.reason ?? "协调 Agent 不可用。" : undefined;

  return <main className="surface">
    <header className="surface__header min-h-0! px-3! py-3! sm:px-4! [&_h1]:mt-1! [&_h1]:text-lg! [&_p]:mt-1!"><div><span className="eyebrow">{detail?.bot.name ?? "Bot"} / 协调会话</span><h1>{detail?.conversation.title ?? "正在加载…"}</h1><p>{detail?.conversation.goal || "消息直接进入此协调会话。"}</p></div></header>
    <div className="min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-4"><div className="mx-auto w-full min-w-0">
      {!state.messages.length && !state.pendingText && !state.temporary.length && <div className="empty-state"><h2>协调会话准备就绪</h2><p>输入需求后将直接进入协调会话。</p></div>}
      <ErrorToast message={state.error || state.actionErrors.coordinator} onDismiss={() => { state.setError(""); state.clearActionError(); }} />
      <Conversation tree={state.tree} temporary={state.temporary} pendingText={state.pendingText} running={state.running} afterTurns={cards} />
    </div></div>
    <footer className="composer px-3! py-2! sm:px-4!"><PromptInput draftKey={`bot:${detail?.conversation.id ?? "pending"}`} placeholder={`直接交给 ${detail?.conversation.title ?? "协调会话"} 处理`} running={state.running} blocked={!!blockedReason} blockedReason={blockedReason} referenceWorkspace={detail ? {botId:detail.bot.id, conversationId:detail.conversation.id} : undefined} referenceProjects={projects.filter(project => project.status === "active" && detail?.conversation.projectBindings?.some(binding => binding.projectId === project.id))} onSubmit={(value, references) => state.send(value,undefined,references)} /></footer>
  </main>;
}
