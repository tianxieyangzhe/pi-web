import {sessionLocks} from '@/application/session-lock';
import {DomainError} from '@/domain/errors';
import { roleState } from "@/domain/role-state";
import { createAgentPreparationService } from "@/application/agent-service";
import { collectAgentMaterials } from "@/infrastructure/projects/agent-materials.server";
import { generateAgentDefinition } from "@/infrastructure/pi/agent-generation.server";
import "server-only";
import { requireRole } from "@/domain/agent-definition";
import { createCatalogService } from "@/application/catalog-service";
import { createSessionExecutionService } from "@/application/session-execution-service";
import {sessionOpenHistory} from "@/infrastructure/sessions/session-open-history.server";
import { createProjectSessionService } from "@/application/project-session-service";
import { createSessionToolsService } from "@/application/session-tools-service";
import { createProjectOperationStore } from "@/infrastructure/projects/operation-journal.server";
import { createNativeContextService } from "@/application/native-context-service";
import { agentRepository } from "@/infrastructure/database/agent-repository.server";
import { mcpRepository } from "@/infrastructure/database/mcp-repository.server";
import { projectRepository } from "@/infrastructure/database/project-repository.server";
import { sessionRepository } from "@/infrastructure/database/session-repository.server";
import { schemaCompatible, assertSchemaCompatible } from "@/infrastructure/database/database.server";
import { database } from "@/infrastructure/database/database.server";
import { piSessionRuntime } from "@/infrastructure/pi/pi-session-runtime.server";
import { normalizeProjectRoot } from "@/infrastructure/projects/project-path.server";
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
  const operations = createProjectOperationStore();
  const catalog = createCatalogService({
    projects: projectRepository,
    mcps: mcpRepository,
    agents: agentRepository,
    normalizeProjectRoot,
    assertProjectMutable(id){for(const session of sessionRepository.listForProject(id)){if(execution.hasLease(session.id)||sessionLocks.has(session.id)||['starting','running','interrupting'].includes(session.state))throw new DomainError('SESSION_BUSY','项目仍有打开或活动操作',409,true);}const pending=operations.list(id).filter(record=>!['completed','failed','acknowledged'].includes(record.phase));if(pending.length)throw new DomainError(pending.some(record=>sessionTools.running(record.operationId))?'SESSION_BUSY':'REQUEST_UNKNOWN','项目仍有活动或待核对操作',409,true);}
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
    catalog
  });
  const execution = createSessionExecutionService({openHistory:sessionOpenHistory,
    sessions: sessionRepository,
    catalog,
    projects: projectRepository,
    runtime: piSessionRuntime,
    readProjectReference,
    assertSessionAllowed: id => bots.assertSessionAllowed(id),
    coordinatorExecutionIds: () => new Set<string>(),
    backgroundInUse: id => { const parent = botRepository.parentForSession(id); return !!parent && botRepository.projectCalls(parent).some(call => call.sessionId === id && ["accepted", "working", "unknown"].includes(call.status)); }
  });
  let sessionTools: ReturnType<typeof createSessionToolsService>;
  const nativeContext = createNativeContextService({changed:id=>execution.events.agent(id,{type:"context_changed"}),sessions:sessionRepository,projects:projectRepository,runtime:piSessionRuntime,assertWritable:assertSchemaCompatible,operations,assertLease:execution.assertLease,assertKnown:(p,id)=>sessionTools.assertKnown(p,id)});
  const projectSessions = createProjectSessionService({openHistory:sessionOpenHistory,preview:value=>piSessionRuntime.preview(value),projects:projectRepository,sessions:sessionRepository,operations,role:(id,p)=>requireRole(catalog.getAgent(id),"project",p),hasLease:execution.hasLease,operationRunning:id=>(sessionTools?.running(id)??false)||nativeContext.running(id),writable:()=>schemaCompatible,releaseHandle:id=>execution.close(id)});
  sessionTools = createSessionToolsService({sessions:sessionRepository,projects:projectRepository,operations,runtime:piSessionRuntime,execution,assertWritable:assertSchemaCompatible,present:projectSessions.present,catalog,externalRunning:nativeContext.running});
  return {
    agentPreparation: createAgentPreparationService({
      collect: collectAgentMaterials,
      generate: generateAgentDefinition
    }),
    catalog,
    sessionTools,
    execution,
    bots,
    projectSessions,
    nativeContext
  };
}
export function listBotReferenceFiles(botId: string, conversationId: string, path: string) {
  assertSchemaCompatible();
  return listReferenceFiles(createBotRepository(database), botFiles.list, botId, conversationId, path);
}

const state = globalThis as typeof globalThis & {
  __sessionServicesV2?: ReturnType<typeof createServices>;
};
export const services = state.__sessionServicesV2 ??= createServices();
