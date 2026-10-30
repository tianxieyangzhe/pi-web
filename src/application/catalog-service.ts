import { DomainError, enumValue, optionalText, requiredText, uniqueStrings } from "@/domain/errors";
import type { Agent, Mcp, McpConfig, Project } from "@/domain/models";
import { validateDefinition, roleETag } from "@/domain/agent-definition";
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
  normalizeProjectRoot
}: CatalogDependencies) {
  return {
    listProjects: () => projectRepository.list(),
    getProject: (id: string) => projectRepository.get(id),
    createProject(body: Record<string, unknown>): Project {
      return projectRepository.create({
        name: requiredText(body.name, "name", "项目名称"),
        description: optionalText(body.description),
        kind: enumValue(body.kind, projectKinds, "kind", "code"),
        rootPath: normalizeProjectRoot(body.rootPath),
        status: "active"
      });
    },
    updateProject(id: string, body: Record<string, unknown>): Project {
      const current = projectRepository.get(id);
      if (!current) throw new DomainError("NOT_FOUND", "项目不存在", 404, true);
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
      });
      return updated!;
    },
    deleteProject(id: string): void {
      if (projectRepository.isInUse(id)) {
        throw new DomainError("RESOURCE_IN_USE", "项目正在被工作线使用", 423, true);
      }
      if (!projectRepository.delete(id)) throw new DomainError("NOT_FOUND", "项目不存在", 404, true);
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
    listAgents: () => agentRepository.list().map(value => ({
      ...value,
      writeETag: roleETag(value)
    })),
    getAgent: (id: string) => agentRepository.get(id),
    getAgentVersion: (id:string,revision:number,sha256:string) => agentRepository.getVersion(id,revision,sha256),
    createAgent(body: Record<string, unknown>): Agent {
      return saveRole(null, body);
    },
    updateAgent(id: string, body: Record<string, unknown>): Agent {
      return saveRole(id, body);
    },
    deleteAgent(id: string): {deleted:boolean;archived:boolean} {
      const current = agentRepository.get(id);
      if (!current) throw new DomainError("NOT_FOUND", "角色不存在", 404, true);
      if (agentRepository.isInUse(id)) {
        agentRepository.update(id, { status: "archived" }, roleETag(current));
        return {deleted:false,archived:true};
      }
      if (!agentRepository.delete(id)) throw new DomainError("NOT_FOUND", "角色不存在", 404, true);
      return {deleted:true,archived:false};
    }
  };
  function saveRole(id: string | null, body: Record<string, unknown>): Agent {
    if(Object.keys(body).some(k=>!['name','description','kind','definition','status','writeETag'].includes(k)))throw new DomainError('INVALID_ROLE','角色请求包含未支持字段',422,true);
    const current = id ? agentRepository.get(id) : null;
    if (id && !current) throw new DomainError('NOT_FOUND', '角色不存在', 404, true);
    const kind = enumValue(body.kind ?? current?.kind, ['coordinator', 'project'] as const, 'kind');
    if (current?.kind && kind !== current.kind) throw new DomainError('INVALID_ROLE', '角色用途不可在编辑时改变', 409, true);
    const name = requiredText(body.name ?? current?.name, 'name', '角色名称'),
      description = optionalText(body.description === undefined ? current?.description : body.description);
    if ([...name].length > 120 || description && [...description].length > 2000) throw new DomainError('INVALID_ROLE', '名称或描述超长', 422, true);
    const definition = validateDefinition(body.definition ?? current?.definition, kind);
    definition.capabilities.readProjects = false;
    const input = {
      name,
      description,
      kind,
      botId: null,
      projectId: null,
      sourceTemplateId: null,
      definition,
      status: enumValue(body.status ?? current?.status, resourceStatuses, 'status', 'active')
    };
    return current ? agentRepository.update(current.id, input, String(body.writeETag ?? ''))! : agentRepository.create(input);
  }
}
