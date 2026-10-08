import { Bot, CircleStop } from "lucide-react";
import type { Project } from "../../../domain/models";
import { Conversation } from "./conversation";
import { PromptInput } from "../prompt-input";
import { useProjectSession } from "./use-project-session";

export function ProjectSessionView({ project, session }: { project: Project; session: ReturnType<typeof useProjectSession> }) {
  const activeSession = session.sessions.find((item) => item.id === session.sessionId);
  return <main className="surface">
    <header className="surface__header"><div><span className="eyebrow">项目会话</span><h1>{project.name}</h1><p>{activeSession?.purpose || "消息直接进入此项目的工作线。"}</p></div><div className="header-actions">{session.sessionId && <button aria-label="结束工作线" title="结束工作线" onClick={() => void session.end()}><CircleStop size={16} /></button>}</div></header>
    <div className="surface__body"><div className="content-width">{session.messages.length === 0 && !session.pendingText && <div className="empty-state"><Bot size={28} /><h2>项目工作线准备就绪</h2><p>输入任务后将直接调用该项目 Session。</p></div>}<Conversation messages={session.messages} pendingText={session.pendingText} streamingText={session.streamingText} activities={session.activities} running={session.running} />{session.error && <button className="error-banner" onClick={() => session.setError("")}>{session.error}</button>}</div></div>
    <footer className="composer"><PromptInput placeholder={`直接交给 ${project.name} 处理`} running={session.running} blocked={session.compacting} onSubmit={(value) => void session.send(value)} onStop={() => void session.interrupt()} /></footer>
  </main>;
}
