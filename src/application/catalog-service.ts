import { DomainError, enumValue, optionalText, requiredText, uniqueStrings } from "@/domain/errors";
import type { Agent, Mcp, McpConfig, Project } from "@/domain/models";
import { validateDefinition, roleETag } from "@/domain/agent-definition";
import {exactFields} from "./project-session-service";
import type { CatalogDependencies } from "@/application/ports/catalog";
const resourceStatuses = ["active", "disabled", "archived"] as const;
const projectKinds = ["code", "knowledge", "general"] as const;
const mcpPolicies = ["read_only", "approval", "allow"] as const;
function stringRecord(value: unknown, field: string): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", `${field}必须是对象`, 400, true);
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new DomainError("INVALID_INPUT", `${field}.${key}必须是字符串`, 400, true);
    }
    result[key] = item;
  }
  return result;
}
function parseMcpConfig(value: unknown): McpConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "MCP 配置必须是对象", 400, true);
  }
  const config = value as Record<string, unknown>;
  const kind = enumValue(config.kind, ["built_in", "stdio", "streamable_http"] as const, "config.kind");
  if (kind === "built_in") {
    return {
      kind,
      implementation: "workspace"
    };
  }
  if (kind === "stdio") {
    return {
      kind,
      command: requiredText(config.command, "config.command", "命令"),
      args: uniqueStrings(config.args, "config.args"),
      envSecretRefs: stringRecord(config.envSecretRefs, "config.envSecretRefs")
    };
  }
  const url = requiredText(config.url, "config.url", "URL");
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
  } catch {
    throw new DomainError("INVALID_INPUT", "MCP URL 必须是 HTTP(S) URL", 400, true);
  }
  return {
    kind,
    url,
    authSecretRef: optionalText(config.authSecretRef)
  };
}
export function createCatalogService({
  projects: projectRepository,
  mcps: mcpRepository,
  agents: agentRepository,
  normalizeProjectRoot, assertProjectMutable, validateAssistant, assistantInUse, resolveAssistantSource
}: CatalogDependencies) {
  return {
    listProjects: () => projectRepository.list().map(value=>({...value,writeETag:roleETag(value)})),
    presentProject:(value:Project)=>({...value,writeETag:roleETag(value)}),
    getProject: (id: string) => projectRepository.get(id),
    createProject(body: Record<string, unknown>): Project {
      validateProjectBody(body,false);
      return projectRepository.create({
        name: requiredText(body.name, "name", "项目名称"),
        description: optionalText(body.description),
        kind: enumValue(body.kind, projectKinds, "kind", "code"),
        rootPath: normalizeProjectRoot(body.rootPath),
        status: "active"
      });
    },
    updateProject(id: string, body: Record<string, unknown>, expected?:string): Project {
      validateProjectBody(body,true);
      const current = projectRepository.get(id);
      if (!current) throw new DomainError("NOT_FOUND", "项目不存在", 404, true);
      match(current,expected);
      if(body.rootPath!==undefined&&normalizeProjectRoot(body.rootPath)!==current.rootPath&&projectRepository.isInUse(id))throw new DomainError("PROJECT_REFERENCED","已有会话或其他记录引用此项目目录",409,true);
      if(body.status!==undefined&&body.status!==current.status)assertProjectMutable?.(id);
      const updated = projectRepository.update(id, {
        ...(body.name !== undefined ? {
          name: requiredText(body.name, "name", "项目名称")
        } : {}),
        ...(body.description !== undefined ? {
          description: optionalText(body.description)
        } : {}),
        ...(body.kind !== undefined ? {
          kind: enumValue(body.kind, projectKinds, "kind")
        } : {}),
        ...(body.rootPath !== undefined ? {
          rootPath: normalizeProjectRoot(body.rootPath)
        } : {}),
        ...(body.status !== undefined ? {
          status: enumValue(body.status, resourceStatuses, "status")
        } : {})
      },expected);
      if(!updated)throw new DomainError("NOT_FOUND","项目不存在",404,true);return updated;
    },
    deleteProject(id: string, expected?:string): void {
      const current=projectRepository.get(id);if(!current)throw new DomainError("NOT_FOUND","项目不存在",404,true);match(current,expected);assertProjectMutable?.(id);
      if (projectRepository.isInUse(id)) {
        throw new DomainError("PROJECT_REFERENCED", "项目仍被会话或历史记录引用", 409, true);
      }
      if (!projectRepository.delete(id,expected)) throw new DomainError("NOT_FOUND", "项目不存在", 404, true);
    },
    listMcps: () => mcpRepository.list(),
    getMcp: (id: string) => mcpRepository.get(id),
    createMcp(body: Record<string, unknown>): Mcp {
      return mcpRepository.create({
        name: requiredText(body.name, "name", "MCP 名称"),
        description: optionalText(body.description),
        config: parseMcpConfig(body.config),
        accessPolicy: enumValue(body.accessPolicy, mcpPolicies, "accessPolicy", "approval"),
        status: "active"
      });
    },
    updateMcp(id: string, body: Record<string, unknown>): Mcp {
      const current = mcpRepository.get(id);
      if (!current) throw new DomainError("NOT_FOUND", "MCP 不存在", 404, true);
      return mcpRepository.update(id, {
        ...(body.name !== undefined ? {
          name: requiredText(body.name, "name", "MCP 名称")
        } : {}),
        ...(body.description !== undefined ? {
          description: optionalText(body.description)
        } : {}),
        ...(body.config !== undefined ? {
          config: parseMcpConfig(body.config)
        } : {}),
        ...(body.accessPolicy !== undefined ? {
          accessPolicy: enumValue(body.accessPolicy, mcpPolicies, "accessPolicy")
        } : {}),
        ...(body.status !== undefined ? {
          status: enumValue(body.status, resourceStatuses, "status")
        } : {})
      })!;
    },
    deleteMcp(id: string): void {
      if (mcpRepository.isInUse(id)) {
        throw new DomainError("RESOURCE_IN_USE", "MCP 正在被工作线使用", 423, true);
      }
      if (!mcpRepository.delete(id)) throw new DomainError("NOT_FOUND", "MCP 不存在", 404, true);
    },
    listAgents: () => agentRepository.list().map(presentAgent),
    listReferenceAgents(context:Record<string,unknown>={}) {
      if(Object.keys(context).some(k=>!['projectId','workspaceId'].includes(k))||Object.values(context).some(v=>typeof v!=='string'||!v.trim()))throw new DomainError('INVALID_INPUT','引用范围无效',400,true);
      const projectId=context.projectId as string|undefined,workspaceId=context.workspaceId as string|undefined;
      let projects:Array<{id:string;rootPath:string}>=[];
      if(workspaceId){
        if(!resolveAssistantSource)throw new DomainError('REFERENCE_OUTSIDE_SCOPE','无法核验工作区',403,true);
        projects=resolveAssistantSource({kind:'workspace',workspaceId,projectIds:projectId?[projectId]:null});
      }else if(projectId){const p=projectRepository.get(projectId);if(!p||p.status!=='active')throw new DomainError('NOT_FOUND','项目不可用',404,true);projects=[p];}
      const scoped:Agent[]=[],unbound:Agent[]=[];
      for(const agent of agentRepository.list()){
        const definition=agent.definition;if(agent.status!=='active'||!agent.contentSha256||!definition)continue;
        const source=definition.source;
        if(definition.format===4?definition.scope==='global'&&source===null:!source&&definition.scope!=='workspace'){unbound.push(agent);continue;}
        if(!source)continue;
        if(source.kind==='workspace'){
          if(workspaceId===source.workspaceId&&(source.projectIds===null||source.projectIds.length===0||projects.some(p=>source.projectIds!.includes(p.id))))scoped.push(agent);
        }else{
          const owner=projectRepository.get(source.projectId);
          if(projects.some(p=>p.id===source.projectId||workspaceId&&owner?.status==='active'&&owner.rootPath===p.rootPath))scoped.push(agent);
        }
      }
      return [...scoped,...unbound].map(presentAgent);
    },
    presentAgent,
    getAgent: (id: string) => agentRepository.get(id),
    getAgentVersion: (id:string,revision:number,sha256:string) => agentRepository.getVersion(id,revision,sha256),
    createAgent(body: Record<string, unknown>): Agent {
      return saveRole(null, body);
    },
    updateAgent(id: string, body: Record<string, unknown>): Agent {
      return saveRole(id, body);
    },
    deleteAgent(id: string, expected?:string): {deleted:boolean;archived:boolean} {
      const current = agentRepository.get(id);
      if (!current) throw new DomainError("NOT_FOUND", "角色不存在", 404, true);
      match(current,expected);
      if (agentRepository.isInUse(id) || assistantInUse?.(id)) {
        agentRepository.update(id, { status: "archived" }, roleETag(current));
        return {deleted:false,archived:true};
      }
      if (!agentRepository.delete(id)) throw new DomainError("NOT_FOUND", "角色不存在", 404, true);
      return {deleted:true,archived:false};
    }
  };
  function presentAgent(value:Agent) {const {id,name,description,kind,revision,contentSha256,status,createdAt,updatedAt}=value;return {id,name,description,kind,revision,contentSha256,status,createdAt,updatedAt,writeETag:roleETag(value),markdown:value.contentSha256?value.markdown??null:null,definition:value.contentSha256?value.definition:null,legacy:!value.contentSha256};}
  function match(value:object,expected?:string){if(!expected)throw new DomainError('PRECONDITION_REQUIRED','缺少If-Match',428,true);if(roleETag(value)!==expected)throw new DomainError('WRITE_CONFLICT','资源已变化，请重新读取',409,true);}
  function validateProjectBody(body:Record<string,unknown>,patch:boolean){
    exactFields(body,patch?['name','description','kind','rootPath','status']:['name','description','kind','rootPath']);
    if(patch&&!Object.keys(body).length)throw new DomainError('INVALID_INPUT','至少提供一个修改字段',400,true);
    if(body.name!==undefined&&(typeof body.name!=='string'||!body.name.trim()||[...body.name.trim()].length>120)||body.description!==undefined&&body.description!==null&&(typeof body.description!=='string'||[...body.description.trim()].length>2000))throw new DomainError('INVALID_INPUT','项目名称或说明无效',400,true);
  }
  function saveRole(id: string | null, body: Record<string, unknown>): Agent {
    if(Object.keys(body).some(k=>!['name','description','kind','definition','status','writeETag'].includes(k)))throw new DomainError('INVALID_ROLE','角色请求包含未支持字段',422,true);
    const current = id ? agentRepository.get(id) : null;
    if (id && !current) throw new DomainError('NOT_FOUND', '角色不存在', 404, true);
    if(current)match(current,String(body.writeETag??""));
    if(current&&(current.projectId||current.sourceTemplateId))throw new DomainError("INVALID_ROLE","历史归属资料请创建新的独立Agent",409,true);
    if(body.description!==undefined&&body.description!==null&&typeof body.description!=="string")throw new DomainError("INVALID_INPUT","Agent说明无效",400,true);
    const kind = enumValue(body.kind ?? current?.kind, ['project'] as const, 'kind');
    if (current?.kind && kind !== current.kind) throw new DomainError('INVALID_ROLE', '角色用途不可在编辑时改变', 409, true);
    const name = requiredText(body.name ?? current?.name, 'name', '角色名称'),
      description = optionalText(body.description === undefined ? current?.description : body.description);
    if ([...name].length > 120 || description && [...description].length > 2000) throw new DomainError('INVALID_ROLE', '名称或描述超长', 422, true);
    const definition = validateDefinition(body.definition ?? current?.definition, kind);
    if((!current||body.definition!==undefined)&&definition.mode==='custom'&&definition.source?.kind==='workspace'&&(definition.source.projectIds?.length??0)>0)throw new DomainError('INVALID_ROLE','工作区自定义助手只能作用于工作区自身',422,true);
    if((!current||body.definition!==undefined)&&definition.workspaceRules!==undefined)throw new DomainError('INVALID_ROLE','项目生成只能包含项目规则，请移除旧工作区规则',422,true);
    if((!current||body.definition!==undefined)&&definition.format!==4)throw new DomainError('INVALID_ROLE','请使用统一助手格式',422,true);
    validateAssistant?.(definition);
    const input = {
      name,
      description,
      kind,
      projectId: null,
      sourceTemplateId: null,
      definition,
      status: enumValue(body.status ?? current?.status, resourceStatuses, 'status', 'active')
    };
    return current ? agentRepository.update(current.id, input, String(body.writeETag ?? ''))! : agentRepository.create(input);
  }
}
