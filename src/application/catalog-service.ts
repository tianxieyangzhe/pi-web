import {
  DomainError,
  enumValue,
  optionalText,
  requiredText,
  uniqueStrings,
} from "@/domain/errors";
import type {
  Agent,
  AgentPolicy,
  Mcp,
  McpConfig,
  PiAgentExtension,
  Project,
} from "@/domain/models";
import type { CatalogDependencies } from "@/application/ports/catalog";

const resourceStatuses = ["active", "disabled", "archived"] as const;
const projectKinds = ["code", "knowledge", "general"] as const;
const accessModes = ["read", "write"] as const;
const mcpPolicies = ["read_only", "approval", "allow"] as const;
const thinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

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

function isForbiddenModelSettingKey(key: string) {
  const normalized = key.replace(/[_-]/g, "").toLowerCase();
  return normalized === "model" ||
    normalized === "provider" ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("baseurl") ||
    normalized.endsWith("modelid");
}

function containsModelConfiguration(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsModelConfiguration);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) =>
    isForbiddenModelSettingKey(key) ||
    containsModelConfiguration(item)
  );
}

function parseMcpConfig(value: unknown): McpConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "MCP 配置必须是对象", 400, true);
  }
  const config = value as Record<string, unknown>;
  const kind = enumValue(
    config.kind,
    ["built_in", "stdio", "streamable_http"] as const,
    "config.kind",
  );
  if (kind === "built_in") {
    return { kind, implementation: "workspace" };
  }
  if (kind === "stdio") {
    return {
      kind,
      command: requiredText(config.command, "config.command", "命令"),
      args: uniqueStrings(config.args, "config.args"),
      envSecretRefs: stringRecord(config.envSecretRefs, "config.envSecretRefs"),
    };
  }
  const url = requiredText(config.url, "config.url", "URL");
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
  } catch {
    throw new DomainError("INVALID_INPUT", "MCP URL 必须是 HTTP(S) URL", 400, true);
  }
  return { kind, url, authSecretRef: optionalText(config.authSecretRef) };
}

function parseAgentExtension(value: unknown): PiAgentExtension {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  if ("model" in source || "provider" in source || "modelId" in source || "baseUrl" in source || "apiKey" in source) {
    throw new DomainError(
      "MODEL_SELECTION_FORBIDDEN",
      "Agent 不能配置模型、Provider、API 地址或凭据",
      400,
      true,
    );
  }
  const settings = source.settings;
  if (settings !== undefined && (!settings || typeof settings !== "object" || Array.isArray(settings))) {
    throw new DomainError("INVALID_INPUT", "extension.settings 必须是对象", 400, true);
  }
  if (containsModelConfiguration(settings)) {
    throw new DomainError(
      "MODEL_SELECTION_FORBIDDEN",
      "Agent settings 不能包含模型、Provider、API 地址或凭据",
      400,
      true,
    );
  }
  return {
    instruction: optionalText(source.instruction),
    thinkingLevel: source.thinkingLevel === null || source.thinkingLevel === undefined
      ? null
      : enumValue(source.thinkingLevel, thinkingLevels, "extension.thinkingLevel"),
    tools: source.tools === null ? null : uniqueStrings(source.tools, "extension.tools"),
    excludeTools: uniqueStrings(source.excludeTools, "extension.excludeTools"),
    extensionSources: uniqueStrings(source.extensionSources, "extension.extensionSources"),
    skillPaths: uniqueStrings(source.skillPaths, "extension.skillPaths"),
    settings: (settings ?? {}) as Record<string, unknown>,
  };
}

function parseAgentPolicy(value: unknown): AgentPolicy {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const max = source.maxParallelSessions ?? 4;
  if (!Number.isInteger(max) || (max as number) < 1 || (max as number) > 32) {
    throw new DomainError(
      "INVALID_INPUT",
      "maxParallelSessions 必须是 1 到 32 的整数",
      400,
      true,
    );
  }
  return {
    allowProjectWrite: source.allowProjectWrite === true,
    allowExternalWrite: source.allowExternalWrite === true,
    allowDelegation: source.allowDelegation === true,
    maxParallelSessions: max as number,
  };
}

export function createCatalogService({
  projects: projectRepository,
  mcps: mcpRepository,
  agents: agentRepository,
  normalizeProjectRoot,
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
      accessMode: enumValue(body.accessMode, accessModes, "accessMode", "read"),
      status: "active",
    });
  },
  updateProject(id: string, body: Record<string, unknown>): Project {
    const current = projectRepository.get(id);
    if (!current) throw new DomainError("NOT_FOUND", "项目不存在", 404, true);
    const updated = projectRepository.update(id, {
      ...(body.name !== undefined ? { name: requiredText(body.name, "name", "项目名称") } : {}),
      ...(body.description !== undefined ? { description: optionalText(body.description) } : {}),
      ...(body.kind !== undefined ? { kind: enumValue(body.kind, projectKinds, "kind") } : {}),
      ...(body.rootPath !== undefined ? { rootPath: normalizeProjectRoot(body.rootPath) } : {}),
      ...(body.accessMode !== undefined
        ? { accessMode: enumValue(body.accessMode, accessModes, "accessMode") }
        : {}),
      ...(body.status !== undefined
        ? { status: enumValue(body.status, resourceStatuses, "status") }
        : {}),
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
      status: "active",
    });
  },
  updateMcp(id: string, body: Record<string, unknown>): Mcp {
    const current = mcpRepository.get(id);
    if (!current) throw new DomainError("NOT_FOUND", "MCP 不存在", 404, true);
    return mcpRepository.update(id, {
      ...(body.name !== undefined ? { name: requiredText(body.name, "name", "MCP 名称") } : {}),
      ...(body.description !== undefined ? { description: optionalText(body.description) } : {}),
      ...(body.config !== undefined ? { config: parseMcpConfig(body.config) } : {}),
      ...(body.accessPolicy !== undefined
        ? { accessPolicy: enumValue(body.accessPolicy, mcpPolicies, "accessPolicy") }
        : {}),
      ...(body.status !== undefined
        ? { status: enumValue(body.status, resourceStatuses, "status") }
        : {}),
    })!;
  },
  deleteMcp(id: string): void {
    if (mcpRepository.isInUse(id)) {
      throw new DomainError("RESOURCE_IN_USE", "MCP 正在被工作线使用", 423, true);
    }
    if (!mcpRepository.delete(id)) throw new DomainError("NOT_FOUND", "MCP 不存在", 404, true);
  },

  listAgents: () => agentRepository.list(),
  getAgent: (id: string) => agentRepository.get(id),
  createAgent(body: Record<string, unknown>): Agent {
    return agentRepository.create({
      name: requiredText(body.name, "name", "Agent 名称"),
      description: optionalText(body.description),
      extension: parseAgentExtension(body.extension),
      policy: parseAgentPolicy(body.policy),
      status: "active",
    });
  },
  updateAgent(id: string, body: Record<string, unknown>): Agent {
    const current = agentRepository.get(id);
    if (!current) throw new DomainError("NOT_FOUND", "Agent 不存在", 404, true);
    return agentRepository.update(id, {
      ...(body.name !== undefined ? { name: requiredText(body.name, "name", "Agent 名称") } : {}),
      ...(body.description !== undefined ? { description: optionalText(body.description) } : {}),
      ...(body.extension !== undefined ? { extension: parseAgentExtension(body.extension) } : {}),
      ...(body.policy !== undefined ? { policy: parseAgentPolicy(body.policy) } : {}),
      ...(body.status !== undefined
        ? { status: enumValue(body.status, resourceStatuses, "status") }
        : {}),
    })!;
  },
  deleteAgent(id: string): void {
    if (agentRepository.isInUse(id)) {
      throw new DomainError("RESOURCE_IN_USE", "Agent 已被工作线引用，请归档", 423, true);
    }
    if (!agentRepository.delete(id)) throw new DomainError("NOT_FOUND", "Agent 不存在", 404, true);
  },
  };
}
