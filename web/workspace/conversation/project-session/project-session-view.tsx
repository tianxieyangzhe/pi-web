import type { Project } from '../../../domain/models';
import { SessionConversationView } from '../session-conversation-view';
import type { useProjectSession } from './use-project-session';
export function ProjectSessionView({onOpenFileLink,project,session,botParent}:{onOpenFileLink?:(href:string)=>void;project:Project;session:ReturnType<typeof useProjectSession>;botParent?:{title:string;onReturn:()=>void}}) {
  const active=session.sessions.find(item=>item.id===session.sessionId);
  return <SessionConversationView onOpenFileLink={onOpenFileLink} title={project.name} purpose={active?.purpose} label={botParent?`${botParent.title} / 项目会话`:'项目会话'} ended={active?.state==='ended'} blockedReason={active?.botParent?'请通过所属历史协调入口处理此会话':undefined} referenceProjects={[project]} header={botParent&&<button className="text-action" onClick={botParent.onReturn}>← 返回总对话</button>} session={{...session,send:(text,references)=>session.send(text,false,references)}}/>;
}
