import type { Project } from '../../../domain/models';
import { SessionConversationView } from '../session-conversation-view';
import type { useProjectSession } from './use-project-session';
export function ProjectSessionView({scrollRevision,onOpenFileLink,project,session,botParent}:{scrollRevision?:number;onOpenFileLink?:(href:string)=>void;project:Project;session:ReturnType<typeof useProjectSession>;botParent?:{title:string;onReturn:()=>void}}) {
  const active=session.sessions.find(item=>item.id===session.sessionId);
  return <SessionConversationView scrollRevision={scrollRevision} allowedActions={active?.allowedActions} onOpenFileLink={onOpenFileLink} title={project.name} purpose={active?.purpose} label={botParent?`${botParent.title} / 项目会话`:'项目会话'} blockedReason={active?.botParent?'请通过所属历史协调入口处理此会话':undefined} referenceProjects={[project]} header={botParent&&<button className="text-action" onClick={botParent.onReturn}>← 返回总对话</button>} session={{...session,send:(text,references,webSearch,toolSearch)=>session.send(text,false,references,webSearch,toolSearch)}}/>;
}
