import 'server-only';
import { services } from './composition-root.server';
import { workspaceServices } from './workspace.server';
import { projectRulesService } from './project-rules.server';
import { database } from '@/infrastructure/database/database.server';
import { createApplicationEventQueries } from '@/infrastructure/database/application-event-queries';
import { DomainError } from '@/domain/errors';
import type { ResourceSubscription } from '@/shared/protocol/application-event-response.server';

const queries = createApplicationEventQueries(database);

/** Reads only existing API projections; navigation never parses a Pi transcript. */
export function resolveApplicationResource(resource: string): ResourceSubscription {
  if (resource === 'catalog') return {
    read: () => ({ projects: services.catalog.listProjects(), agents: services.catalog.listAgents(), mcps: services.catalog.listMcps(), workspaces: workspaceServices.list() }),
    matches: change => change.topic === 'catalog',
  };
  if (resource === 'navigation') return {
    read: () => queries.navigation(id => services.execution.events.activitySnapshot(id)?.running === true, id => workspaceServices.events.activitySnapshot(id)?.running === true),
    matches: change => change.topic === 'catalog' || change.topic === 'sessions' || change.topic === 'session',
  };
  const sessions = /^\/api\/(projects|workspaces)\/([^/]+)\/sessions$/.exec(resource);
  if (sessions) {
    const [,kind,id] = sessions;
    return {
      read: () => kind === 'projects' ? services.projectSessions.list(id) : workspaceServices.sessions(id),
      matches: change => change.topic === 'sessions' || change.topic === 'catalog' || change.topic === 'session' && queries.ownsSession(kind as 'projects'|'workspaces',id,change.key ?? ''),
    };
  }
  const sessionResource = /^\/api\/(projects|workspaces)\/([^/]+)\/sessions\/([^/]+)\/(messages|context-files)$/.exec(resource);
  if(sessionResource){
    const [,kind,ownerId,sessionId,part]=sessionResource;
    return {
      read:()=>{
        if(!queries.ownsSession(kind as 'projects'|'workspaces',ownerId,sessionId))throw new DomainError('NOT_FOUND','会话不存在',404,true);
        if(kind==='projects'){
          services.projectSessions.get(ownerId,sessionId);
          return part==='messages'?services.execution.messages(sessionId):services.execution.contextFiles(sessionId);
        }
        return part==='messages'?workspaceServices.messages(ownerId,sessionId):workspaceServices.contextFiles(ownerId,sessionId);
      },
      matches:change=>change.key===sessionId&&(part==='messages'?change.topic==='session':change.topic==='context-files')||change.topic==='sessions'&&(part==='messages'||!queries.ownsSession(kind as 'projects'|'workspaces',ownerId,sessionId)),
    };
  }
  const projectRules = /^\/api\/projects\/([^/]+)\/agent-rules$/.exec(resource);
  const workspaceRules = /^\/api\/workspaces\/([^/]+)\/projects\/([^/]+)\/agent-rules$/.exec(resource);
  if (projectRules || workspaceRules) {
    const identity = projectRules ? { scope: 'project' as const, projectId: projectRules[1] } : { scope: 'workspace' as const, workspaceId: workspaceRules![1], projectId: workspaceRules![2] };
    const key = JSON.stringify(identity.scope === 'project' ? ['project',identity.projectId] : ['workspace',identity.workspaceId,identity.projectId]);
    return { read: () => projectRulesService.read(identity), matches: change => change.topic === 'rules' && change.key === key || change.topic === 'catalog' };
  }
  throw new DomainError('INVALID_INPUT','不支持的订阅资源',400,true);
}
