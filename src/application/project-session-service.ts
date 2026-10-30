import { roleState } from "@/domain/role-state";
import { isRoleSnapshot, requireRole, roleETag } from "@/domain/agent-definition";
import { DomainError, optionalText } from "@/domain/errors";
import type { SessionMemoryRepositoryPort } from "./ports/session-memory";
import { basename } from "node:path";
import type { Session } from "@/domain/models";
import type { ProjectRepositoryPort } from "@/application/ports/catalog";
import type { SessionRepositoryPort } from "@/application/ports/core";
export function createProjectSessionService(dependencies: {
  projects: ProjectRepositoryPort;
  sessions: SessionRepositoryPort;
  memories: Pick<SessionMemoryRepositoryPort, "createSession" | "get">;
  roleStatus?: (s: Session) => ReturnType<typeof roleState>;
  role?: (agentId: string, projectId: string) => import("@/domain/models").AgentSnapshot;
  parent?: (sessionId: string) => {
    botId: string;
    conversationId: string;
    conversationTitle: string;
    sessionId: string;
    available?: boolean;
    reason?: string | null;
  } | null;
}) {
  const {
    projects,
    sessions,
    memories
  } = dependencies;
  function project(projectId: string) {
    const value = projects.get(projectId);
    if (!value) throw new DomainError("NOT_FOUND", "项目不存在", 404, true);
    if (value.status !== "active") throw new DomainError("PROJECT_UNAVAILABLE", "项目当前不可用", 409, true);
    return value;
  }
  function get(projectId: string, sessionId: string): Session {
    project(projectId);
    const value = sessions.get(sessionId);
    if (!value || value.projectId !== projectId) {
      throw new DomainError("NOT_FOUND", "项目工作线不存在", 404, true);
    }
    return value;
  }
  function present(value: Session) {
    const memory = value.sessionMemoryId ? memories.get(value.sessionMemoryId) : null;
    if (memory && memory.projectId !== value.projectId) throw new DomainError("MEMORY_DATA_CORRUPT", "记忆与会话项目不一致", 409, true);
    return {
      botParent: dependencies.parent?.(value.id) ?? null,
      writeETag: roleETag(value),
      agentId: value.agentId,
      agentSnapshot:isRoleSnapshot(value.agentSnapshot)?value.agentSnapshot:null,
      roleState: dependencies.roleStatus?.(value) ?? null,
      memorySummary: memory?.contextJson.summary ?? "",
      id: value.id,
      projectId: value.projectId,
      sessionMemoryId: value.sessionMemoryId,
      purpose: value.purpose,
      state: value.state,
      createdAt: value.createdAt,
      lastActivityAt: value.lastActivityAt,
      endedAt: value.endedAt,
      agent: value.agentSnapshot ? {
        name: value.agentSnapshot.name,
        revision: value.agentSnapshot.revision,
        thinkingLevel: !isRoleSnapshot(value.agentSnapshot) && "extension" in value.agentSnapshot ? value.agentSnapshot.extension.thinkingLevel : null,
        skills: !isRoleSnapshot(value.agentSnapshot) && "extension" in value.agentSnapshot ? value.agentSnapshot.extension.skillPaths.map((path: string) => basename(path)) : [],
        id: value.agentId,
        configured: isRoleSnapshot(value.agentSnapshot)
      } : null,
      mcps: value.mcpSnapshots.map(mcp => ({
        id: mcp.id,
        name: mcp.name,
        accessPolicy: mcp.accessPolicy
      }))
    };
  }
  return {
    list(projectId: string) {
      project(projectId);
      return sessions.listForProject(projectId).map(present);
    },
    get,
    summary(projectId: string, sessionId: string) {
      return present(get(projectId, sessionId));
    },
    create(projectId: string, body: Record<string, unknown> = {}) {
      const value = project(projectId);
      const agentId = String(body.agentId ?? "").trim();
      return present(memories.createSession(value.id, optionalText(body.purpose) ?? "项目会话", optionalText(body.sessionMemoryTemplateId) ?? undefined, optionalText(body.templateWriteETag) ?? undefined, agentId && dependencies.role ? {
        agentId,
        agentSnapshot: dependencies.role(agentId, value.id)
      } : undefined));
    },
    end(projectId: string, sessionId: string) {
      const value = get(projectId, sessionId);
      if (["starting", "running", "interrupting"].includes(value.state)) {
        throw new DomainError("SESSION_RUNNING", "请先停止项目工作线", 409, true);
      }
      return present(sessions.updateRuntime(sessionId, {
        state: "ended",
        endedAt: new Date().toISOString()
      })!);
    }
  };
}
