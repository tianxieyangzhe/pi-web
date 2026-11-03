import {useState} from "react";
import { Bot, CircleStop } from "lucide-react";
import type { Project } from "../../../domain/models";
import { Conversation } from "./conversation";
import { ErrorToast } from "../error-toast";
import { PromptInput } from "../prompt-input";
import { useProjectSession } from "./use-project-session";

export function ProjectSessionView({ project, session,botParent }: { project: Project; session: ReturnType<typeof useProjectSession>;botParent?:{title:string;onReturn:()=>void} }) {
  const [steer,setSteer]=useState(false);
  const activeSession = session.sessions.find((item) => item.id === session.sessionId);
  return <main className="surface">
    <header className="surface__header min-h-0! px-3! py-3! sm:px-4! [&_h1]:mt-1! [&_h1]:text-lg! [&_p]:mt-1!"><div><span className="eyebrow">{botParent?botParent.title+" / 项目会话":"项目会话"}</span>{botParent&&<button className="text-action" onClick={botParent.onReturn}>← 返回总对话</button>}<h1>{project.name}</h1><p>{activeSession?.purpose || "消息直接进入此项目的工作线。"}</p></div><div className="header-actions">{session.sessionId && <button aria-label="结束工作线" title="结束工作线" onClick={() => void session.end()}><CircleStop size={16} /></button>}</div></header>
    <div className="min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-4"><div className="mx-auto w-full min-w-0">{session.ready && session.tree.entries.length === 0 && !session.pendingText && <div className="empty-state"><Bot size={28} /><h2>项目工作线准备就绪</h2><p>输入任务后将直接调用该项目 Session。</p></div>}<Conversation tree={session.tree} temporary={session.temporary} pendingText={session.pendingText} running={session.running} /><ErrorToast message={session.error} onRetry={session.retryOpen} /></div></div>
    <footer className="composer px-3! py-2! sm:px-4!">{activeSession?.botParent&&<label className="bot-intervention"><input type="checkbox" checked={steer} onChange={e=>setSteer(e.target.checked)}/>纠正当前执行</label>}<PromptInput draftKey={`project:${session.sessionId}`} placeholder={`直接交给 ${project.name} 处理`} running={session.running} stopping={session.stopping} blocked={!session.ready||session.compacting||!!activeSession?.botParent||activeSession?.state==='ended'} blockedReason={!session.ready?"请先打开项目会话":session.compacting?"正在压缩原生上下文":activeSession?.botParent?"请在协调会话中输入":activeSession?.state==='ended'?"会话已结束":undefined} referenceProjects={[project]} onSubmit={(value, references) => session.send(value,steer,references)} onStop={session.canStop?() => void session.interrupt():undefined} /></footer>
  </main>;
}
