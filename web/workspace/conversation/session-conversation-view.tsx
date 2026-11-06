import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { isLocalFileLink } from './file-link';
import { Bot } from 'lucide-react';
import type { Project, ProjectFileListing } from '../../domain/models';
import type { MessageReference } from '../../../src/domain/message-references';
import { Conversation } from './project-session/conversation';
import { ErrorToast } from './error-toast';
import { PromptInput } from './prompt-input';
import type { useSessionTree } from './use-session-tree';
export type ConversationController = Pick<ReturnType<typeof useSessionTree>,'tree'|'temporary'|'pendingText'|'running'|'ready'|'error'|'retryOpen'|'connection'> & {
  sessionId:string|null;stopping:boolean;compacting:boolean;
  send:(text:string,references?:MessageReference[],webSearch?:boolean,toolSearch?:boolean)=>Promise<void>;
  interrupt:()=>Promise<void>;end:()=>Promise<void>;
};
export function SessionConversationView({scrollRevision=0,allowedActions,onOpenFileLink,title,label='项目会话',purpose,session,blockedReason,referenceProjects=[],listReferenceFiles,header}:{scrollRevision?:number;allowedActions?:import('../../../src/domain/session-tools').SessionActions;onOpenFileLink?:(href:string)=>void;title:string;label?:string;purpose?:string;session:ConversationController;blockedReason?:string;referenceProjects?:Project[];listReferenceFiles?:(projectId:string,path:string)=>Promise<ProjectFileListing>;header?:import('react').ReactNode}) {
  const viewport = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null), following = useRef(true);
  const [sendRevision, setSendRevision] = useState(0);
  const scrollToBottom = useCallback(() => { const node = viewport.current; if (node) node.scrollTop = node.scrollHeight; }, []);
  useLayoutEffect(() => {
    following.current = true;
    scrollToBottom();
  }, [session.sessionId, scrollRevision, sendRevision, scrollToBottom]);
  useLayoutEffect(() => {
    if (following.current) scrollToBottom();
  }, [session.tree, session.temporary, session.pendingText, session.running, scrollToBottom]);
  useLayoutEffect(() => {
    if (!content.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { if (following.current) scrollToBottom(); });
    observer.observe(content.current);
    return () => observer.disconnect();
  }, [scrollToBottom]);
  return <main className="surface">
    <header className="surface__header min-h-0! px-3! py-3! sm:px-4! [&_h1]:mt-1! [&_h1]:text-lg! [&_p]:mt-1!"><div><span className="eyebrow">{label}</span>{header}<h1>{title}</h1><p>{purpose||'在当前会话中处理任务。'}</p></div></header>
    <div ref={viewport} onScroll={event=>{const node=event.currentTarget;following.current=node.scrollHeight-node.clientHeight-node.scrollTop<=32;}} className="min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-4"><div ref={content} className="mx-auto w-full min-w-0" onClick={event=>{const link=(event.target as Element).closest('a');const href=link?.getAttribute('href');if(href&&isLocalFileLink(href)){event.preventDefault();onOpenFileLink?.(href);}}}>{session.ready&&session.tree.entries.length===0&&!session.pendingText&&<div className="empty-state"><Bot size={28}/><h2>会话准备就绪</h2><p>输入任务后在此会话中执行。</p></div>}<Conversation tree={session.tree} temporary={session.temporary} pendingText={session.pendingText} running={session.running}/><ErrorToast message={session.error} onRetry={session.retryOpen}/></div></div>
    <footer className="composer px-3! py-2! sm:px-4!"><PromptInput draftKey={`session:${session.sessionId}`} placeholder={`交给 ${title} 处理`} running={session.running} stopping={session.stopping} blocked={!session.ready||session.compacting||!!blockedReason||allowedActions?.send.allowed===false} blockedReason={session.connection!=='open'?'会话已关闭':!session.ready?'模型或连接暂不可用，请查看会话设置':session.compacting?'正在压缩原生上下文':blockedReason} referenceProjects={referenceProjects} listReferenceFiles={listReferenceFiles} onSubmit={(text,references,webSearch,toolSearch)=>{following.current=true;scrollToBottom();setSendRevision(value=>value+1);return session.send(text,references,webSearch,toolSearch);}} onStop={session.running&&allowedActions?.interrupt.allowed!==false?()=>void session.interrupt():undefined}/></footer>
  </main>;
}
