import "server-only";

import { createCatalogService } from "@/application/catalog-service";
import { createRoomContentService } from "@/application/room-content-service";
import { createRoomService } from "@/application/room-service";
import { createSessionService } from "@/application/session-service";
import { createWorkspaceService } from "@/application/workspace-service";
import { agentRepository } from "@/infrastructure/database/agent-repository.server";
import { mcpRepository } from "@/infrastructure/database/mcp-repository.server";
import { projectRepository } from "@/infrastructure/database/project-repository.server";
import { roomContentRepository } from "@/infrastructure/database/room-content-repository.server";
import { roomRepository } from "@/infrastructure/database/room-repository.server";
import { sessionRepository } from "@/infrastructure/database/session-repository.server";
import { workspaceRepository } from "@/infrastructure/database/workspace-repository.server";
import { normalizeProjectRoot } from "@/infrastructure/projects/project-path.server";
import { createSessionExecutionService } from "@/application/session-execution-service";
import { piSessionRuntime } from "@/infrastructure/pi/pi-session-runtime.server";

const processState = globalThis as typeof globalThis & {
  __aiWorkspaceRecoveredSessions?: boolean;
};
if (!processState.__aiWorkspaceRecoveredSessions) {
  sessionRepository.markInterruptedAfterRestart();
  processState.__aiWorkspaceRecoveredSessions = true;
}

const catalog = createCatalogService({
  projects: projectRepository,
  mcps: mcpRepository,
  agents: agentRepository,
  normalizeProjectRoot,
});

const baseServices = {
  catalog,
  workspaces: createWorkspaceService(workspaceRepository),
  rooms: createRoomService({
    workspaces: workspaceRepository,
    rooms: roomRepository,
    sessions: sessionRepository,
    contents: roomContentRepository,
  }),
  sessions: createSessionService({
    rooms: roomRepository,
    sessions: sessionRepository,
    catalog,
  }),
  roomContents: createRoomContentService({
    rooms: roomRepository,
    sessions: sessionRepository,
    contents: roomContentRepository,
  }),
};

export const services = {
  ...baseServices,
  execution: createSessionExecutionService({
    sessions: sessionRepository,
    rooms: roomRepository,
    catalog,
    projects: projectRepository,
    runtime: piSessionRuntime,
  }),
};
