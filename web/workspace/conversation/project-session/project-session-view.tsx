import type { Project } from '../../../domain/models';
import { SessionConversationView } from '../session-conversation-view';
import type { useProjectSession } from './use-project-session';
export function ProjectSessionView({scrollRevision,onOpenFileLink,project,session}:{scrollRevision?:number;onOpenFileLink?:(href:string)=>void;project:Project;session:ReturnType<typeof useProjectSession>}) {
  const active=session.sessions.find(item=>item.id===session.sessionId);
  return <SessionConversationView assistantProjectId={project.id} scrollRevision={scrollRevision} allowedActions={active?.allowedActions} onOpenFileLink={onOpenFileLink} title={project.name} purpose={active?.purpose} label='项目会话' referenceProjects={[project]} session={{...session,send:(text,references,webSearch,toolSearch)=>session.send(text,false,references,webSearch,toolSearch)}}/>;
}
