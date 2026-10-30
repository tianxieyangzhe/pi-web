import {useState} from "react";
import { Bot, CircleStop } from "lucide-react";
import type { Project } from "../../../domain/models";
import { Conversation } from "./conversation";
import { PromptInput } from "../prompt-input";
import { useProjectSession } from "./use-project-session";

export function ProjectSessionView({ project, session,botParent }: { project: Project; session: ReturnType<typeof useProjectSession>;botParent?:{title:string;onReturn:()=>void} }) {
  const [steer,setSteer]=useState(false);
  const activeSession = session.sessions.find((item) => item.id === session.sessionId);
  return <main className="surface">
    <header className="surface__header"><div><span className="eyebrow">{botParent?botParent.title+" / 项目会话":"项目会话"}</span>{botParent&&<button className="text-action" onClick={botParent.onReturn}>← 返回总对话</button>}<h1>{project.name}</h1><p>{activeSession?.purpose || "消息直接进入此项目的工作线。"}</p></div><div className="header-actions">{session.sessionId && <button aria-label="结束工作线" title="结束工作线" onClick={() => void session.end()}><CircleStop size={16} /></button>}</div></header>
    <div className="surface__body"><div className="content-width">{session.messages.length === 0 && !session.pendingText && <div className="empty-state"><Bot size={28} /><h2>项目工作线准备就绪</h2><p>输入任务后将直接调用该项目 Session。</p></div>}<Conversation messages={session.messages} pendingText={session.pendingText} streamingText="" activities={[]} liveEntries={session.liveEntries} running={session.running} />{session.error && <button className="error-banner" onClick={() => session.setError("")}>{session.error}</button>}</div></div>
    <footer className="composer">{activeSession?.botParent&&<label className="bot-intervention"><input type="checkbox" checked={steer} onChange={e=>setSteer(e.target.checked)}/>纠正当前执行</label>}<PromptInput draftKey={`project:${session.sessionId}`} placeholder={`直接交给 ${project.name} 处理`} running={session.running} stopping={session.stopping} blocked={session.compacting||!!activeSession?.botParent} blockedReason={session.compacting?"正在压缩原生上下文":activeSession?.botParent?"请在协调会话中输入":undefined} referenceProjects={[project]} onSubmit={(value, references) => session.send(value,steer,references)} onStop={session.canStop?() => void session.interrupt():undefined} /></footer>
  </main>;
}
