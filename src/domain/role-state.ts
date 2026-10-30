import { isRoleSnapshot } from './agent-definition';
import type { Agent, AgentSnapshot, LegacyAgentSnapshot } from './models';
export function roleState(agent: Agent | null, snapshot: AgentSnapshot | LegacyAgentSnapshot | null, _started: boolean, pending: boolean) {
  const configured = isRoleSnapshot(snapshot),
    available = !!agent?.definition && agent.status === 'active',
    newer=!!(configured&&agent&&agent.revision>snapshot.revision);
  return {
    configured,
    available,
    boundRevision: configured ? snapshot.revision : null,
    currentRevision: agent?.revision ?? null,
    name: snapshot?.name ?? agent?.name ?? null,
    status: agent?.status ?? null,
    canAdoptLatest: available && configured && newer && !pending,
    reason: pending ? '请先处理排队、在途、未知执行或待答问题' : !available ? '角色未配置、停用或归档' : null
  };
}
