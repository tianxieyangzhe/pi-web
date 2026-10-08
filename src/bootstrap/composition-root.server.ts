import "server-only";
import {createCatalogService} from "@/application/catalog-service";
import {createSessionExecutionService} from "@/application/session-execution-service";
import {createProjectSessionService} from "@/application/project-session-service";
import {createSessionMemoryService} from "@/application/session-memory-service";
import {createNativeContextService} from "@/application/native-context-service";
import {agentRepository} from "@/infrastructure/database/agent-repository.server";
import {mcpRepository} from "@/infrastructure/database/mcp-repository.server";
import {projectRepository} from "@/infrastructure/database/project-repository.server";
import {sessionRepository} from "@/infrastructure/database/session-repository.server";
import {sessionMemoryRepository} from "@/infrastructure/database/session-memory-repository.server";
import {schemaCompatible,assertSchemaCompatible} from "@/infrastructure/database/database.server";
import {piSessionRuntime} from "@/infrastructure/pi/pi-session-runtime.server";
import {normalizeProjectRoot} from "@/infrastructure/projects/project-path.server";
import {validateSessionMemoryPaths} from "@/infrastructure/projects/session-memory-path.server";
function createServices(){
 const sessionMemories=createSessionMemoryService({memories:sessionMemoryRepository,sessions:sessionRepository,projects:projectRepository,runtime:piSessionRuntime,validatePaths:validateSessionMemoryPaths});
 const processState=globalThis as typeof globalThis & {__recoveredMemorySessions?:boolean};
 if(schemaCompatible&&!processState.__recoveredMemorySessions){sessionRepository.markInterruptedAfterRestart();processState.__recoveredMemorySessions=true;}
 const catalog=createCatalogService({projects:projectRepository,mcps:mcpRepository,agents:agentRepository,normalizeProjectRoot});
 const execution=createSessionExecutionService({sessions:sessionRepository,catalog,projects:projectRepository,runtime:piSessionRuntime,sessionMemories:sessionMemoryRepository,onCompleted:id=>sessionMemories.completed(id)});
 return {catalog,sessionMemories,execution,projectSessions:createProjectSessionService({projects:projectRepository,sessions:sessionRepository,memories:sessionMemoryRepository}),nativeContext:createNativeContextService({sessions:sessionRepository,projects:projectRepository,runtime:piSessionRuntime,assertWritable:assertSchemaCompatible})};
}
const state=globalThis as typeof globalThis & {__memoryOnlyServices?:ReturnType<typeof createServices>};
export const services=state.__memoryOnlyServices??=createServices();
