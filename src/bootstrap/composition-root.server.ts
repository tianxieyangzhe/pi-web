import {projectRulesStore} from '@/infrastructure/agents/project-rules-store.server';
import { createSessionAssistantAccess } from "@/application/session-assistant-service";
import { sessionAssistantStore } from "@/infrastructure/agents/session-assistant-store.server";
import { resolveAssistantSource } from "@/infrastructure/agents/assistant-sources.server";
import {sessionLocks} from '@/application/session-lock';
import {DomainError} from '@/domain/errors';
import { generationSkills } from "@/infrastructure/agents/generation-skills.server";
import {createUnifiedAssistantService} from '@/application/unified-assistant-service';
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
import { piSessionRuntime } from "@/infrastructure/pi/pi-session-runtime.server";
import { normalizeProjectRoot } from "@/infrastructure/projects/project-path.server";
import { resolveProjectReference, readProjectBytes } from "@/infrastructure/projects/project-files.server";
import { sessionContextFiles } from "@/infrastructure/references/session-context-files.server";
function createServices() {
  const operations = createProjectOperationStore();
  const assistants=createSessionAssistantAccess(sessionAssistantStore,(id,revision,hash)=>agentRepository.getVersion(id,revision,hash));
  const catalog = createCatalogService({
    resolveAssistantSource,
    assistantInUse:id=>sessionAssistantStore.inUse(id),
    validateAssistant:definition=>{if((definition.format===3||definition.format===4)&&definition.source){const actual=resolveAssistantSource(definition.source);if(definition.projects?.some(p=>!actual.some(a=>a.id===p.id&&a.name===p.name)))throw new DomainError("INVALID_ROLE","项目规则身份与来源不一致",422,true);}},
    projects: projectRepository,
    mcps: mcpRepository,
    agents: agentRepository,
    normalizeProjectRoot,
    assertProjectMutable(id){for(const session of sessionRepository.listForProject(id)){if(execution.hasLease(session.id)||sessionLocks.has(session.id)||['starting','running','interrupting'].includes(session.state))throw new DomainError('SESSION_BUSY','项目仍有打开或活动操作',409,true);}const pending=operations.list(id).filter(record=>!['completed','failed','acknowledged'].includes(record.phase));if(pending.length)throw new DomainError(pending.some(record=>sessionTools.running(record.operationId))?'SESSION_BUSY':'REQUEST_UNKNOWN','项目仍有活动或待核对操作',409,true);}
  });
  const execution = createSessionExecutionService({projectRules:projectRulesStore,assistants,openHistory:sessionOpenHistory,
    contextFiles:sessionContextFiles,
    assertContextWritable:(projectId,id)=>{assertSchemaCompatible();sessionTools.assertKnown(projectId,id);},
    readContextFile:reference=>{
      const project=projectRepository.get(reference.projectId);
      if(!project||project.status!=='active')throw new DomainError('REFERENCE_OUTSIDE_SCOPE','参考项目不可用',403,true);
      return {name:reference.path.split('/').at(-1)!,bytes:readProjectBytes(project.rootPath,reference.path,50_000_000)};
    },
    sessions: sessionRepository,
    catalog,
    projects: projectRepository,
    runtime: piSessionRuntime,
    resolveProjectReference,
  });
  let sessionTools: ReturnType<typeof createSessionToolsService>;
  const nativeContext = createNativeContextService({changed:id=>execution.events.agent(id,{type:"context_changed"}),sessions:sessionRepository,projects:projectRepository,runtime:piSessionRuntime,assertWritable:assertSchemaCompatible,operations,assertLease:execution.assertLease,assertKnown:(p,id)=>sessionTools.assertKnown(p,id)});
  const projectSessions = createProjectSessionService({openHistory:sessionOpenHistory,preview:value=>piSessionRuntime.preview(value),projects:projectRepository,sessions:sessionRepository,operations,role:(id,p)=>requireRole(catalog.getAgent(id),"project",p),hasLease:execution.hasLease,operationRunning:id=>(sessionTools?.running(id)??false)||nativeContext.running(id),writable:()=>schemaCompatible,releaseHandle:id=>execution.close(id)});
  sessionTools = createSessionToolsService({sessions:sessionRepository,projects:projectRepository,operations,runtime:piSessionRuntime,execution,assertWritable:assertSchemaCompatible,present:projectSessions.present,catalog,externalRunning:nativeContext.running});
  return {
    agentPreparation: createUnifiedAssistantService(createAgentPreparationService({
      skills: generationSkills,
      resolveSource: resolveAssistantSource,
      generate: generateAgentDefinition
    }),source=>{resolveAssistantSource(source);}),
    catalog,
    sessionTools,
    execution,
    projectSessions,
    nativeContext
  };
}
const state = globalThis as typeof globalThis & {
  __sessionServicesV2?: ReturnType<typeof createServices>;
};
export const services = state.__sessionServicesV2 ??= createServices();
