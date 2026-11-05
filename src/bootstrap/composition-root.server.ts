import { roleState } from "@/domain/role-state";
import { createAgentPreparationService } from "@/application/agent-service";
import { collectAgentMaterials } from "@/infrastructure/projects/agent-materials.server";
import { generateAgentDefinition } from "@/infrastructure/pi/agent-generation.server";
import "server-only";
import { requireRole } from "@/domain/agent-definition";
import { createCatalogService } from "@/application/catalog-service";
import { createSessionExecutionService } from "@/application/session-execution-service";
import { createProjectSessionService } from "@/application/project-session-service";
import { createSessionMemoryService } from "@/application/session-memory-service";
import { createNativeContextService } from "@/application/native-context-service";
import { agentRepository } from "@/infrastructure/database/agent-repository.server";
import { mcpRepository } from "@/infrastructure/database/mcp-repository.server";
import { projectRepository } from "@/infrastructure/database/project-repository.server";
import { sessionRepository } from "@/infrastructure/database/session-repository.server";
import { sessionMemoryRepository } from "@/infrastructure/database/session-memory-repository.server";
import { schemaCompatible, assertSchemaCompatible } from "@/infrastructure/database/database.server";
import { database } from "@/infrastructure/database/database.server";
import { piSessionRuntime } from "@/infrastructure/pi/pi-session-runtime.server";
import { normalizeProjectRoot } from "@/infrastructure/projects/project-path.server";
import { validateSessionMemoryPaths } from "@/infrastructure/projects/session-memory-path.server";
import { createBotRepository } from "@/infrastructure/database/bot-repository";
import { botWorkspace } from "@/infrastructure/bots/bot-workspace.server";
import { readProjectReference } from "@/infrastructure/projects/project-files.server";
import { botFiles, readBotReference } from "@/infrastructure/bots/bot-files.server";
import { listBotReferenceFiles as listReferenceFiles } from "@/application/bot-reference-files";
import { botRuntime } from "@/infrastructure/pi/bot-runtime.server";
import { createBotService } from "@/application/bot-service";
import type { SessionRuntimeInput } from "@/application/ports/pi-runtime";
import { botRuntimeInstanceId } from "@/infrastructure/bots/runtime-instance.server";
function createServices() {
  const sessionMemories = createSessionMemoryService({
    memories: sessionMemoryRepository,
    sessions: sessionRepository,
    projects: projectRepository,
    runtime: piSessionRuntime,
    validatePaths: validateSessionMemoryPaths
  });
  const processState = globalThis as typeof globalThis & {
    __recoveredMemorySessions?: boolean;
  };
  if (schemaCompatible && !processState.__recoveredMemorySessions) {
    sessionRepository.markInterruptedAfterRestart();
    processState.__recoveredMemorySessions = true;
  }
  const catalog = createCatalogService({
    projects: projectRepository,
    mcps: mcpRepository,
    agents: agentRepository,
    normalizeProjectRoot
  });
  const botRepository = createBotRepository(database);
  const bots = createBotService({
    repository: botRepository,
    workspace: botWorkspace,
    runtime: Object.assign(botRuntime, { projectHandle: async (input: SessionRuntimeInput) => {
      if (!piSessionRuntime.getHandle(input.session.id) && !input.session.nativeRef) await piSessionRuntime.initializeProject(input, ref => {
        const updated = sessionRepository.setNativeRefIfAbsent(input.session.id, ref);
        if (!updated?.nativeRef) throw new Error("无法保存项目原生身份");
        return updated.nativeRef;
      });
      return piSessionRuntime.projectHandle(input);
    } }),
    runtimeInstanceId: botRuntimeInstanceId,
    readProjectReference,
    readBotReference,
    sessions: sessionRepository,
    projects: projectRepository,
    memories: sessionMemoryRepository,
    catalog,
    onCompleted: id => sessionMemories.completed(id)
  });
  const execution = createSessionExecutionService({
    sessions: sessionRepository,
    catalog,
    projects: projectRepository,
    runtime: piSessionRuntime,
    readProjectReference,
    sessionMemories: sessionMemoryRepository,
    onCompleted: id => sessionMemories.completed(id),
    memoryBusy: id => sessionMemories.busy(id),
    assertSessionAllowed: id => bots.assertSessionAllowed(id),
    coordinatorExecutionIds: () => new Set<string>(),
    backgroundInUse: id => { const parent = botRepository.parentForSession(id); return !!parent && botRepository.projectCalls(parent).some(call => call.sessionId === id && ["accepted", "working", "unknown"].includes(call.status)); }
  });
  return {
    agentPreparation: createAgentPreparationService({
      collect: collectAgentMaterials,
      generate: generateAgentDefinition
    }),
    catalog,
    sessionMemories,
    execution,
    bots,
    projectSessions: createProjectSessionService({
      projects: projectRepository,
      sessions: sessionRepository,
      memories: sessionMemoryRepository,
      roleStatus: s => roleState(catalog.getAgent(s.agentId ?? ''), s.agentSnapshot, !!s.nativeRef || botRepository.available() && botRepository.list('bot_conversations').some(conversation => botRepository.projectCalls(conversation.id).some(call => call.sessionId === s.id)), ['starting', 'running', 'interrupting'].includes(s.state) || botRepository.available() && botRepository.list('bot_conversations').some(conversation => botRepository.projectCalls(conversation.id).some(call => call.sessionId === s.id && ['accepted','working','unknown'].includes(call.status)))),
      role: (agentId, projectId) => requireRole(catalog.getAgent(agentId), 'project', projectId),
      parent: id => {
        const parent = botRepository.parentForSession(id);
        if (!parent) return null;
        const c = botRepository.get('bot_conversations', parent);
        const session=sessionRepository.get(id),parentBot=c?botRepository.get('bots',c.botId):null,projectAgent=session?catalog.getAgent(session.agentId??''):null;
        return c ? {
          botId: c.botId,
          conversationId: c.id,
          conversationTitle: c.title,
          sessionId: id,
          available: parentBot?.status==='active'&&projectAgent?.status==='active'&&session?.collaborationState==='active',
          reason: parentBot?.status!=='active'?'Bot 已停用':session?.collaborationState!=='active'?'此项目参与已停用':projectAgent?.status!=='active'?'项目 Agent 尚未配置或停用':null
        } : null;
      }
    }),
    nativeContext: createNativeContextService({
      sessions: sessionRepository,
      projects: projectRepository,
      runtime: piSessionRuntime,
      assertWritable: assertSchemaCompatible
    })
  };
}
export function listBotReferenceFiles(botId: string, conversationId: string, path: string) {
  assertSchemaCompatible();
  return listReferenceFiles(createBotRepository(database), botFiles.list, botId, conversationId, path);
}

const state = globalThis as typeof globalThis & {
  __memoryOnlyServices?: ReturnType<typeof createServices>;
};
export const services = state.__memoryOnlyServices ??= createServices();
