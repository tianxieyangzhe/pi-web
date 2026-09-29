import "server-only";

import { createCatalogService } from "@/application/catalog-service";
import { createRoomContentService } from "@/application/room-content-service";
import { createRoomContextService } from "@/application/room-context-service";
import { createRoomService } from "@/application/room-service";
import { createSessionExecutionService } from "@/application/session-execution-service";
import { createSessionService } from "@/application/session-service";
import { createProjectSessionService } from "@/application/project-session-service";
import { agentRepository } from "@/infrastructure/database/agent-repository.server";
import { mcpRepository } from "@/infrastructure/database/mcp-repository.server";
import { projectRepository } from "@/infrastructure/database/project-repository.server";
import { roomContentRepository } from "@/infrastructure/database/room-content-repository.server";
import { roomRepository } from "@/infrastructure/database/room-repository.server";
import { roomRunRepository } from "@/infrastructure/database/room-run-repository.server";
import { sessionRepository } from "@/infrastructure/database/session-repository.server";
import { taskRepository } from "@/infrastructure/database/task-repository.server";
import { piSessionRuntime } from "@/infrastructure/pi/pi-session-runtime.server";
import { runRoomDirect } from "@/infrastructure/pi/pi-room-direct-runtime.server";
import { runRoomRouter } from "@/infrastructure/pi/pi-room-router-runtime.server";
import { createCrossProjectRoomRunService } from "@/application/room-runs/cross-project-room-run-service";
import { normalizeProjectRoot } from "@/infrastructure/projects/project-path.server";

const processState = globalThis as typeof globalThis & { __aiWorkspaceRecoveredSessionsV4?: boolean };
if (!processState.__aiWorkspaceRecoveredSessionsV4) {
  sessionRepository.markInterruptedAfterRestart();
  processState.__aiWorkspaceRecoveredSessionsV4 = true;
}

const catalog = createCatalogService({
  projects: projectRepository,
  mcps: mcpRepository,
  agents: agentRepository,
  normalizeProjectRoot,
});

const roomContext = createRoomContextService({
  rooms: roomRepository,
  contents: roomContentRepository,
  runs: roomRunRepository,
  tasks: taskRepository,
  sessions: sessionRepository,
  projects: projectRepository,
  agents: agentRepository,
  mcps: mcpRepository,
});

const execution = createSessionExecutionService({
  sessions: sessionRepository,
  rooms: roomRepository,
  catalog,
  projects: projectRepository,
  runtime: piSessionRuntime,
});

export const services = {
  catalog,
  rooms: createRoomService({
    rooms: roomRepository,
    projects: projectRepository,
    runs: roomRunRepository,
    tasks: taskRepository,
    sessions: sessionRepository,
    contents: roomContentRepository,
  }),
  sessions: createSessionService({ rooms: roomRepository, sessions: sessionRepository }),
  roomContents: createRoomContentService({
    rooms: roomRepository,
    runs: roomRunRepository,
    tasks: taskRepository,
    sessions: sessionRepository,
    contents: roomContentRepository,
  }),
  roomContext,
  projectSessions: createProjectSessionService({ projects: projectRepository, sessions: sessionRepository }),
  crossProjectRoomRuns: createCrossProjectRoomRunService({
    rooms: roomRepository,
    runs: roomRunRepository,
    tasks: taskRepository,
    sessions: sessionRepository,
    catalog,
    projects: projectRepository,
    context: roomContext,
    router: runRoomRouter,
    direct: runRoomDirect,
    execution,
  }),
  execution,
};
