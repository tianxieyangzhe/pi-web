import { createHash } from "node:crypto";
import {canonical} from "./project-operations";
import { DomainError } from "./errors";
import type { Agent, AgentSnapshot, AgentSnapshotRef, AgentDefinition } from "./models";
export const capabilityNames = ["readFiles", "writeFiles", "readProjects", "dispatchTasks", "dispatchProjectWrites", "exchangeMessages"] as const;
export const emptyCapabilities = () => Object.fromEntries(capabilityNames.map(k => [k, false])) as AgentDefinition["capabilities"];
export function validateDefinition(value: unknown, kind: "coordinator" | "project"): AgentDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("INVALID_ROLE", "角色定义必须完整", 422, true);
  const v = value as Record<string, unknown>,
    c = v.capabilities as Record<string, unknown>;
  if (Object.keys(v).some(k => !["instructions", "capabilities"].includes(k)) || typeof v.instructions !== "string" || !v.instructions.trim() || [...v.instructions].length > 16000 || !c || Array.isArray(c) || typeof c !== "object" || Object.keys(c).length !== capabilityNames.length || capabilityNames.some(k => typeof c[k] !== "boolean") || Buffer.byteLength(JSON.stringify(v)) > 65536) throw new DomainError("INVALID_ROLE", "角色正文或能力格式不正确", 422, true);
  if (kind === "project" && (c.readProjects || c.dispatchTasks || c.dispatchProjectWrites) || c.dispatchProjectWrites && !c.dispatchTasks) throw new DomainError("INVALID_ROLE", "项目角色不能读取跨项目范围或派发任务，派发修改须先允许任务调度", 422, true);
  if (v.instructions.includes('来源限制：禁止直接修改工作目录文件。') && c.writeFiles || v.instructions.includes('来源限制：禁止派发项目任务。') && (c.dispatchTasks || c.dispatchProjectWrites)) throw new DomainError('ROLE_CAPABILITY_DENIED', '源定义保留禁止权限，请先明确修改指导限制', 422, true);
  return {
    instructions: v.instructions,
    capabilities: Object.fromEntries(capabilityNames.map(k => [k, c[k]])) as AgentDefinition["capabilities"]
  };
}
export function roleETag(value: object) {
  const agent=value as Partial<Agent>;
  const persisted="contentSha256" in agent && "id" in agent ? {id:agent.id,name:agent.name,description:agent.description,kind:agent.kind,revision:agent.revision,contentSha256:agent.contentSha256,status:agent.status,createdAt:agent.createdAt,updatedAt:agent.updatedAt} : value;
  return '"' + createHash('sha256').update(canonical(persisted)).digest('hex') + '"';
}
export function snapshot(agent: Agent): AgentSnapshot {
  if (!agent.kind || !agent.definition || !agent.contentSha256) throw new DomainError("ROLE_NOT_CONFIGURED", "请先配置正式角色 Markdown 版本", 409, true);
  return {
    agentId: agent.id,
    revision: agent.revision,
    kind: agent.kind,
    botId: null,
    projectId: null,
    contentSha256: agent.contentSha256,
    name: agent.name,
    description: agent.description,
    definition: validateDefinition(agent.definition, agent.kind)
  };
}
export function snapshotReference(value: AgentSnapshot): AgentSnapshotRef {
  return {
    agentId: value.agentId,
    revision: value.revision,
    kind: value.kind,
    botId: null,
    projectId: null,
    contentSha256: value.contentSha256,
    name: value.name,
    description: value.description
  };
}
export function validateSnapshotReference(value: unknown): AgentSnapshotRef {
  const v = value as AgentSnapshotRef;
  if (!v || typeof v !== "object" || Object.keys(v).some(k => !["agentId", "revision", "kind", "botId", "projectId", "contentSha256", "name", "description"].includes(k)) || typeof v.agentId !== "string" || !v.agentId || !Number.isInteger(v.revision) || v.revision < 1 || !["coordinator", "project"].includes(v.kind) || v.botId !== null || v.projectId !== null || typeof v.contentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(v.contentSha256) || typeof v.name !== "string" || !v.name.trim() || [...v.name].length > 120 || v.description !== null && (typeof v.description !== "string" || [...v.description].length > 2000)) throw new DomainError("ROLE_BINDING_INVALID", "角色版本引用无效", 409, true);
  return v;
}
export function validateSnapshot(value: unknown): AgentSnapshot {
  const v = value as AgentSnapshot;
  validateSnapshotReference({agentId:v?.agentId,revision:v?.revision,kind:v?.kind,botId:v?.botId,projectId:v?.projectId,contentSha256:v?.contentSha256,name:v?.name,description:v?.description});
  if (Object.keys(v).some(k => k !== "definition" && !["agentId", "revision", "kind", "botId", "projectId", "contentSha256", "name", "description"].includes(k)) || !v.definition) throw new DomainError("ROLE_BINDING_INVALID", "角色快照损坏", 409, true);
  validateDefinition(v.definition, v.kind);
  return v;
}
export function isRoleSnapshot(value: unknown): value is AgentSnapshot {
  return !!value && typeof value === "object" && "agentId" in value && "definition" in value && "contentSha256" in value;
}
export function readSessionSnapshot(value: unknown): AgentSnapshot | import('./models').LegacyAgentSnapshot | null {
  if (value === null) return null;
  if (isRoleSnapshot(value)) return validateSnapshot(value);
  if (value && typeof value === "object" && !Array.isArray(value) && "agentId" in value && "definition" in value && "name" in value) {
    return value as import('./models').LegacyRoleSnapshot;
  }
  const v = value as import('./models').LegacyPiAgentSnapshot;
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !['id', 'name', 'description', 'extension', 'policy', 'revision', 'status', 'createdAt', 'updatedAt'].includes(k)) || typeof v.id !== 'string' || typeof v.name !== 'string' || !Number.isInteger(v.revision) || v.revision < 1 || !v.extension || !v.policy || !Array.isArray(v.extension.skillPaths) || !Array.isArray(v.extension.extensionSources) || !Array.isArray(v.extension.excludeTools) || typeof v.policy.allowProjectWrite !== 'boolean' || typeof v.policy.allowExternalWrite !== 'boolean' || !Number.isInteger(v.policy.maxParallelTasks) || !Array.isArray(v.extension.skillPaths) || v.extension.skillPaths.some(x => typeof x !== 'string') || v.extension.extensionSources.some(x => typeof x !== 'string') || v.extension.excludeTools.some(x => typeof x !== 'string') || v.extension.tools !== null && (!Array.isArray(v.extension.tools) || v.extension.tools.some(x => typeof x !== 'string')) || v.extension.instruction !== null && typeof v.extension.instruction !== 'string' || v.extension.thinkingLevel !== null && !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(v.extension.thinkingLevel) || !v.extension.settings || typeof v.extension.settings !== 'object' || Array.isArray(v.extension.settings)) throw new DomainError('ROLE_BINDING_INVALID', '历史角色快照损坏，未转换为空配置', 409, true);
  return v;
}
export function requireRole(agent: Agent | null, kind: "coordinator" | "project", _ownerId: string): AgentSnapshot {
  if (!agent || agent.status !== "active") throw new DomainError("ROLE_UNAVAILABLE", "角色不可用或已停用", 409, true);
  const s = snapshot(agent);
  if (s.kind !== kind) throw new DomainError("ROLE_BINDING_INVALID", "角色用途与当前 Bot/项目绑定不匹配", 409, true);
  return s;
}
export function boundRole(agent: Agent | null, value: unknown, kind: "coordinator" | "project", ownerId: string): AgentSnapshot {
  requireRole(agent, kind, ownerId);
  const s = validateSnapshot(value);
  if (s.agentId !== agent!.id || s.contentSha256 !== agent!.contentSha256 && s.revision === agent!.revision || s.kind !== kind || s.revision > agent!.revision) throw new DomainError("ROLE_BINDING_INVALID", "会话角色绑定无效", 409, true);
  return s;
}
