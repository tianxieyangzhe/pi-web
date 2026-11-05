import { isLocalFileLink } from './file-link';
import { Bot, CircleStop } from 'lucide-react';
import type { Project, ProjectFileListing } from '../../domain/models';
import type { MessageReference } from '../../../src/domain/message-references';
import { Conversation } from './project-session/conversation';
import { ErrorToast } from './error-toast';
import { PromptInput } from './prompt-input';
import type { useSessionTree } from './use-session-tree';
export type ConversationController = Pick<ReturnType<typeof useSessionTree>,'tree'|'temporary'|'pendingText'|'running'|'ready'|'error'|'retryOpen'> & {
  sessionId:string|null;stopping:boolean;compacting:boolean;
  send:(text:string,references?:MessageReference[])=>Promise<void>;
  interrupt:()=>Promise<void>;end:()=>Promise<void>;
};
export function SessionConversationView({onOpenFileLink,title,label='项目会话',purpose,session,ended=false,blockedReason,referenceProjects=[],listReferenceFiles,header}:{onOpenFileLink?:(href:string)=>void;title:string;label?:string;purpose?:string;session:ConversationController;ended?:boolean;blockedReason?:string;referenceProjects?:Project[];listReferenceFiles?:(projectId:string,path:string)=>Promise<ProjectFileListing>;header?:import('react').ReactNode}) {
  return <main className="surface">
    <header className="surface__header min-h-0! px-3! py-3! sm:px-4! [&_h1]:mt-1! [&_h1]:text-lg! [&_p]:mt-1!"><div><span className="eyebrow">{label}</span>{header}<h1>{title}</h1><p>{purpose||'在当前会话中处理任务。'}</p></div><div className="header-actions">{session.sessionId&&<button aria-label="结束工作线" title="结束工作线" disabled={session.running||session.compacting||ended} onClick={()=>void session.end()}><CircleStop size={16}/></button>}</div></header>
    <div className="min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-4"><div className="mx-auto w-full min-w-0" onClick={event=>{const link=(event.target as Element).closest('a');const href=link?.getAttribute('href');if(href&&isLocalFileLink(href)){event.preventDefault();onOpenFileLink?.(href);}}}>{session.ready&&session.tree.entries.length===0&&!session.pendingText&&<div className="empty-state"><Bot size={28}/><h2>会话准备就绪</h2><p>输入任务后在此会话中执行。</p></div>}<Conversation tree={session.tree} temporary={session.temporary} pendingText={session.pendingText} running={session.running}/><ErrorToast message={session.error} onRetry={session.retryOpen}/></div></div>
    <footer className="composer px-3! py-2! sm:px-4!"><PromptInput draftKey={`session:${session.sessionId}`} placeholder={`交给 ${title} 处理`} running={session.running} stopping={session.stopping} blocked={!session.ready||session.compacting||ended||!!blockedReason} blockedReason={!session.ready?'请先打开会话':session.compacting?'正在压缩原生上下文':ended?'会话已结束':blockedReason} referenceProjects={referenceProjects} listReferenceFiles={listReferenceFiles} onSubmit={(text,references)=>session.send(text,references)} onStop={session.running?()=>void session.interrupt():undefined}/></footer>
  </main>;
}
