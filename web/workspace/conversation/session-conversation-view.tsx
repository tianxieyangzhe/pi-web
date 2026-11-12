import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isLocalFileLink } from './file-link';
import { MessagesSquare } from 'lucide-react';
import type { Project, ProjectFileListing } from '../../domain/models';
import type { MessageReference } from '../../../src/domain/message-references';
import { Conversation } from './project-session/conversation';
import { ErrorToast } from './error-toast';
import { PromptInput } from './prompt-input';
import { api } from '../../api/client';
import { contentBlocks } from './session-tree-projection';
import type { useSessionTree } from './use-session-tree';
export type ConversationController = Pick<ReturnType<typeof useSessionTree>,'tree'|'temporary'|'steeringQueue'|'runMetrics'|'pendingText'|'running'|'ready'|'error'|'retryOpen'|'connection'|'contextFiles'|'addContextFiles'|'removeContextFile'|'leaseId'|'eventRevision'> & {
  sessionId:string|null;stopping:boolean;compacting:boolean;
  send:(text:string,references?:MessageReference[],webSearch?:boolean,toolSearch?:boolean)=>Promise<void>;
  interrupt:()=>Promise<void>;end:()=>Promise<void>;
};
export function SessionConversationView({scrollRevision=0,allowedActions,onOpenFileLink,title,label='项目会话',purpose,session,blockedReason,referenceProjects=[],listReferenceFiles,header,assistantProjectId,assistantWorkspaceId}:{assistantProjectId?:string;assistantWorkspaceId?:string;scrollRevision?:number;allowedActions?:import('../../../src/domain/session-tools').SessionActions;onOpenFileLink?:(href:string)=>void;title:string;label?:string;purpose?:string;session:ConversationController;blockedReason?:string;referenceProjects?:Project[];listReferenceFiles?:(projectId:string,path:string)=>Promise<ProjectFileListing>;header?:import('react').ReactNode}) {
  const assistantBase=session.sessionId?(assistantWorkspaceId?`/api/workspaces/${encodeURIComponent(assistantWorkspaceId)}/sessions/${encodeURIComponent(session.sessionId)}`:assistantProjectId?`/api/projects/${encodeURIComponent(assistantProjectId)}/sessions/${encodeURIComponent(session.sessionId)}`:null):null;
  const [assistantLabel,setAssistantLabel]=useState<{base:string;name:string}|null>(null);
  const assistantReadVersion=useRef(0);
  useEffect(()=>{
    if(!assistantBase)return;
    const controller=new AbortController(),version=++assistantReadVersion.current;
    void api.getSessionAssistant(assistantBase,controller.signal).then(view=>{
      if(!controller.signal.aborted&&version===assistantReadVersion.current)setAssistantLabel({base:assistantBase,name:view.selection?.name??''});
    }).catch(()=>{});
    return()=>controller.abort();
  },[assistantBase,session.eventRevision]);
  const viewport = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null), following = useRef(true);
  const [sendRevision, setSendRevision] = useState(0);
  const inputHistory = useMemo(() => session.tree.entries.flatMap(({entry}) => {
    const message=entry.message as Record<string,unknown> | undefined;
    if (entry.type !== 'message' || message?.role !== 'user') return [];
    const text=contentBlocks(message.content).filter(block=>block.type==='text').map(block=>block.text??'').join('\n');
    return text.trim()?[text]:[];
  }),[session.tree]);
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
    <div ref={viewport} onScroll={event=>{const node=event.currentTarget;following.current=node.scrollHeight-node.clientHeight-node.scrollTop<=32;}} className="min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-4"><div ref={content} className="mx-auto w-full min-w-0" onClick={event=>{const link=(event.target as Element).closest('a');const href=link?.getAttribute('href');if(href&&isLocalFileLink(href)){event.preventDefault();onOpenFileLink?.(href);}}}>{session.ready&&session.tree.entries.length===0&&!session.pendingText&&<div className="empty-state"><MessagesSquare size={28}/><h2>会话准备就绪</h2><p>输入任务后在此会话中执行。</p></div>}<Conversation key={session.sessionId} tree={session.tree} steeringQueue={session.steeringQueue} temporary={session.temporary} pendingText={session.pendingText} running={session.running} runMetrics={session.runMetrics}/><ErrorToast message={session.error} onRetry={session.retryOpen}/></div></div>
    <footer className="composer px-3! py-2! sm:px-4!"><PromptInput assistantName={assistantLabel?.base===assistantBase?assistantLabel.name:undefined} onSelectAssistant={assistantBase&&session.leaseId?async(id,signal)=>{++assistantReadVersion.current;const view=await api.selectSessionAssistant(assistantBase,id,session.leaseId!,signal);if(!signal.aborted){++assistantReadVersion.current;setAssistantLabel({base:assistantBase,name:view.selection?.name??''});}}:undefined} assistantProjectId={assistantProjectId} assistantWorkspaceId={assistantWorkspaceId} key={session.sessionId} contextFiles={session.contextFiles} onAddContextFiles={session.addContextFiles} onRemoveContextFile={session.removeContextFile} inputHistory={inputHistory} draftKey={`session:${session.sessionId}`} placeholder={`交给 ${title} 处理`} running={session.running} stopping={session.stopping} blocked={!session.ready||session.compacting||session.stopping||!!blockedReason||(session.running?allowedActions?.steer?.allowed===false:allowedActions?.send.allowed===false)} blockedReason={session.connection!=='open'?'会话已关闭':!session.ready?'模型或连接暂不可用，请查看会话设置':session.compacting?'正在压缩原生上下文':blockedReason} referenceProjects={referenceProjects} listReferenceFiles={listReferenceFiles} onSubmit={(text,references,webSearch,toolSearch)=>{following.current=true;scrollToBottom();setSendRevision(value=>value+1);return session.send(text,references,webSearch,toolSearch);}} onStop={session.running&&allowedActions?.interrupt.allowed!==false?()=>void session.interrupt():undefined}/></footer>
  </main>;
}
