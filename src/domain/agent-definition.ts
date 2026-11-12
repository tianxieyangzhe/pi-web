import { createHash } from "node:crypto";
import {canonical} from "./project-operations";
import { DomainError } from "./errors";
import type { Agent, AgentSnapshot, AgentSnapshotRef, AgentDefinition } from "./models";
import { isAssistantDefinition, isLegacyAssistantDefinition, isUnifiedAssistant } from "./assistant-document";
export const capabilityNames = ["readFiles", "writeFiles"] as const;
export const emptyCapabilities = () => Object.fromEntries(capabilityNames.map(k => [k, false])) as NonNullable<AgentDefinition["capabilities"]>;
export function validateDefinition(value: unknown, kind: "project", allowEmpty = false): AgentDefinition {
  if (kind !== "project" || !value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("INVALID_ROLE", "角色定义必须完整", 422, true);
  if(isUnifiedAssistant(value)){
    const v=value,s=v.source;
    if(Object.keys(v).some(k=>!['format','scope','source','systemPromptMode','systemPrompt'].includes(k))||!['inherit','replace'].includes(v.systemPromptMode)||typeof v.systemPrompt!=='string'||v.systemPrompt.includes('\0')||Buffer.byteLength(v.systemPrompt)>262144||v.systemPromptMode==='inherit'&&v.systemPrompt!==''||!allowEmpty&&v.systemPromptMode==='replace'&&!v.systemPrompt.trim())throw new DomainError('INVALID_ROLE','助手系统提示词无效',422,true);
    if(v.scope==='global'){if(s!==null)throw new DomainError('INVALID_ROLE','通用型助手不能指定项目或工作区',422,true);return v;}
    if(!s||typeof s!=='object'||Array.isArray(s)||!['project','workspace'].includes(v.scope)||s.kind==='project'&&(v.scope!=='project'||Object.keys(s).some(k=>!['kind','projectId'].includes(k))||typeof s.projectId!=='string'||!s.projectId)||s.kind==='workspace'&&(v.scope!=='workspace'||Object.keys(s).some(k=>!['kind','workspaceId','projectIds'].includes(k))||typeof s.workspaceId!=='string'||!s.workspaceId||s.projectIds!==null&&(!Array.isArray(s.projectIds)||!s.projectIds.length||s.projectIds.length>32||s.projectIds.some(id=>typeof id!=='string'||!id)||new Set(s.projectIds).size!==s.projectIds.length))||!['project','workspace'].includes(s.kind))throw new DomainError('INVALID_ROLE','请选择有效作用范围',422,true);
    return v;
  }
  if (isAssistantDefinition(value)) {
    const v=value;
    if(Object.keys(v).some(k=>!['format','mode','scope','systemPrompt','source','projects','workspaceRules'].includes(k))||!['custom','generated'].includes(v.mode)||!['project','workspace'].includes(v.scope)||typeof v.systemPrompt!=='string'||!Array.isArray(v.projects)||v.projects.length>32)throw new DomainError('INVALID_ROLE','助手正文格式无效',422,true);
    if(v.workspaceRules!==undefined&&(typeof v.workspaceRules!=='string'||v.mode!=='generated'||v.scope!=='workspace'||!allowEmpty&&!v.workspaceRules.trim()))throw new DomainError('INVALID_ROLE','工作区规则仅用于工作区生成助手',422,true);
    const {workspaceRules,...base}=v;
    const legacy={...base,format:2,instructions:workspaceRules??''};
    if(v.source?.kind==='workspace'&&!v.source.projectIds.length)legacy.source={...v.source,projectIds:['__workspace__']};
    if(Buffer.byteLength(v.systemPrompt)+Buffer.byteLength(workspaceRules??'')+v.projects.reduce((n,p)=>n+(typeof p?.rules==='string'?Buffer.byteLength(p.rules):0),0)>262144)throw new DomainError('INVALID_ROLE','助手正文超过256KiB',422,true);
    if(v.mode==='custom'){
      if(v.projects.length||!allowEmpty&&!v.systemPrompt.trim()||Buffer.byteLength(v.systemPrompt)>262144)throw new DomainError('INVALID_ROLE','自定义助手只接受完整的系统提示词',422,true);
      validateDefinition(legacy,kind,allowEmpty);
    }else{
      if(v.systemPrompt!==''||!v.source)throw new DomainError('INVALID_ROLE','从项目生成只接受项目规则',422,true);
      // Reuse the historical scope/identity validation without exposing its removed field.
      validateDefinition(legacy,kind,true);
      if(!allowEmpty&&(!v.projects.length&&!v.workspaceRules?.trim()||v.source.kind==='workspace'&&v.projects.length!==v.source.projectIds.length))throw new DomainError('INVALID_ROLE','所选范围缺少规则',422,true);
    }
    return v as unknown as AgentDefinition;
  }
  if (isLegacyAssistantDefinition(value)) {
    const v=value;
    if(Object.keys(v).some(k=>!['format','mode','scope','systemPrompt','instructions','source','projects'].includes(k)) || !['generated','custom'].includes(v.mode)||!['project','workspace'].includes(v.scope)||typeof v.systemPrompt!=='string'||typeof v.instructions!=='string'||!Array.isArray(v.projects)||v.projects.length>32||Buffer.byteLength(v.systemPrompt)+Buffer.byteLength(v.instructions)+v.projects.reduce((n,p)=>n+(typeof p?.rules==='string'?Buffer.byteLength(p.rules):0),0)>262144)throw new DomainError('INVALID_ROLE','助手格式或容量无效',422,true);
    if(v.mode==='generated'&&v.systemPrompt!=='')throw new DomainError('INVALID_ROLE','从项目生成保留Pi默认系统提示词',422,true);
    if(!allowEmpty&&!v.systemPrompt.trim()&&!v.instructions.trim()&&!v.projects.length)throw new DomainError('INVALID_ROLE','请提供助手正文',422,true);
    if(v.source!==null){const q=v.source;if(!q||typeof q!=='object'||(q.kind==='project'?(Object.keys(q).some(k=>!['kind','projectId'].includes(k))||typeof q.projectId!=='string'||!q.projectId||v.scope!=='project'):(q.kind!=='workspace'||Object.keys(q).some(k=>!['kind','workspaceId','projectIds'].includes(k))||typeof q.workspaceId!=='string'||!q.workspaceId||!Array.isArray(q.projectIds)||!q.projectIds.length||q.projectIds.some(id=>typeof id!=='string'||!id)||new Set(q.projectIds).size!==q.projectIds.length||v.scope!=='workspace')))throw new DomainError('INVALID_ROLE','助手来源范围无效',422,true);}
    if(v.scope==='workspace'&&v.source?.kind!=='workspace'||v.mode==='generated'&&!v.source)throw new DomainError('INVALID_ROLE','请选择助手来源',422,true);
    const ids=new Set<string>();for(const p of v.projects){if(!p||Object.keys(p).some(k=>!['id','name','rules'].includes(k))||typeof p.id!=='string'||!p.id||ids.has(p.id)||typeof p.name!=='string'||!p.name||typeof p.rules!=='string'||!p.rules.trim())throw new DomainError('INVALID_ROLE','项目规则无效',422,true);ids.add(p.id);}
    if(v.projects.length&&(!v.source||v.source.kind==='project'&&(v.projects.length!==1||v.projects[0].id!==v.source.projectId)||v.source.kind==='workspace'&&(v.projects.length!==v.source.projectIds.length||v.projects.some(p=>!v.source||v.source.kind!=='workspace'||!v.source.projectIds.includes(p.id)))))throw new DomainError('INVALID_ROLE','项目规则与所选范围不一致',422,true);
    if(!allowEmpty&&v.mode==='generated'&&!v.projects.length)throw new DomainError('INVALID_ROLE','缺少项目规则',422,true);
    return v as unknown as AgentDefinition;
  }
  const v = value as Record<string, unknown>,
    c = v.capabilities as Record<string, unknown>;
  if (Object.keys(v).some(k => !["instructions", "capabilities"].includes(k)) || typeof v.instructions !== "string" || !v.instructions.trim() || [...v.instructions].length > 16000 || !c || Array.isArray(c) || typeof c !== "object" || Object.keys(c).length !== capabilityNames.length || capabilityNames.some(k => typeof c[k] !== "boolean") || Buffer.byteLength(JSON.stringify(v)) > 65536) throw new DomainError("INVALID_ROLE", "角色正文或能力格式不正确", 422, true);
  if (v.instructions.includes('来源限制：禁止直接修改工作目录文件。') && c.writeFiles) throw new DomainError('ROLE_CAPABILITY_DENIED', '源定义保留禁止权限，请先明确修改指导限制', 422, true);
  return {
    instructions: v.instructions,
    capabilities: Object.fromEntries(capabilityNames.map(k => [k, c[k]])) as NonNullable<AgentDefinition["capabilities"]>
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
    projectId: null,
    contentSha256: value.contentSha256,
    name: value.name,
    description: value.description
  };
}
export function validateSnapshotReference(value: unknown): AgentSnapshotRef {
  const v = value as AgentSnapshotRef;
  if (!v || typeof v !== "object" || Object.keys(v).some(k => !["agentId", "revision", "kind", "projectId", "contentSha256", "name", "description"].includes(k)) || typeof v.agentId !== "string" || !v.agentId || !Number.isInteger(v.revision) || v.revision < 1 || !["project"].includes(v.kind) || v.projectId !== null || typeof v.contentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(v.contentSha256) || typeof v.name !== "string" || !v.name.trim() || [...v.name].length > 120 || v.description !== null && (typeof v.description !== "string" || [...v.description].length > 2000)) throw new DomainError("ROLE_BINDING_INVALID", "角色版本引用无效", 409, true);
  return v;
}
export function validateSnapshot(value: unknown): AgentSnapshot {
  const v = value as AgentSnapshot;
  validateSnapshotReference({agentId:v?.agentId,revision:v?.revision,kind:v?.kind,projectId:v?.projectId,contentSha256:v?.contentSha256,name:v?.name,description:v?.description});
  if (Object.keys(v).some(k => k !== "definition" && !["agentId", "revision", "kind", "projectId", "contentSha256", "name", "description"].includes(k)) || !v.definition) throw new DomainError("ROLE_BINDING_INVALID", "角色快照损坏", 409, true);
  validateDefinition(v.definition, v.kind);
  return v;
}
export function isRoleSnapshot(value: unknown): value is AgentSnapshot {
  return !!value && typeof value === "object" && "agentId" in value && "definition" in value && "contentSha256" in value;
}
export function readSessionSnapshot(value: unknown): AgentSnapshot | import('./models').LegacyAgentSnapshot | null {
  if (value === null) return null;
  if (isRoleSnapshot(value)) return validateSnapshot(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const identity = value as Record<string, unknown>;
    const agentId = identity.agentId ?? identity.id;
    if (typeof agentId === "string" && agentId && typeof identity.name === "string" && Number.isInteger(identity.revision) && Number(identity.revision) > 0) {
      return { agentId, name: identity.name, revision: Number(identity.revision), legacy: true };
    }
  }
  throw new DomainError('ROLE_BINDING_INVALID', '历史角色引用无效', 409, true);
}

export function requireRole(agent: Agent | null, kind: "project", _ownerId: string): AgentSnapshot {
  if (!agent || agent.status !== "active") throw new DomainError("ROLE_UNAVAILABLE", "角色不可用或已停用", 409, true);
  const s = snapshot(agent);
  if(s.definition.format===4&&s.definition.source?.kind==='project'&&s.definition.source.projectId!==_ownerId)throw new DomainError('ROLE_BINDING_INVALID','助手不适用于此项目',409,true);
  if (s.definition.scope === "workspace") throw new DomainError("ROLE_BINDING_INVALID", "工作区助手不能用于独立项目", 409, true);
  if (s.kind !== kind) throw new DomainError("ROLE_BINDING_INVALID", "角色用途与当前项目绑定不匹配", 409, true);
  return s;
}
export function boundRole(agent: Agent | null, value: unknown, kind: "project", ownerId: string): AgentSnapshot {
  requireRole(agent, kind, ownerId);
  const s = validateSnapshot(value);
  if (s.agentId !== agent!.id || s.contentSha256 !== agent!.contentSha256 && s.revision === agent!.revision || s.kind !== kind || s.revision > agent!.revision) throw new DomainError("ROLE_BINDING_INVALID", "会话角色绑定无效", 409, true);
  return s;
}
