import type {
  Agent,
  JsonObject,
  Mcp,
  Room,
  RoomContent,
  RoomProject,
  RoomRun,
  Session,
  Task,
} from "@/domain/models";

export interface RoomRepositoryPort {
  list(): Room[];
  listForProject(projectId: string): Room[];
  get(id: string): Room | null;
  listProjects(roomId: string): RoomProject[];
  create(input: { kind: Room["kind"]; title: string; projectIds: string[] }): Room;
  update(id: string, patch: Partial<Pick<Room, "title" | "status">>): Room | null;
  touch(id: string): void;
  incrementContextRevision(id: string): Room | null;
  delete(id: string): boolean;
}

export type CreateSessionRecord = Pick<
  Session,
  "roomId" | "projectId" | "purpose" | "agentId" | "agentSnapshot" | "mcpIds" | "mcpSnapshots"
>;

export interface SessionRepositoryPort {
  listForRoom(roomId: string): Session[];
  listForProject(projectId: string): Session[];
  get(id: string): Session | null;
  create(input: CreateSessionRecord): Session;
  updateRuntime(
    id: string,
    patch: { state?: Session["state"]; nativeRef?: JsonObject | null; nativeMetadata?: JsonObject; endedAt?: string | null },
  ): Session | null;
  markInterruptedAfterRestart(): number;
}

export interface RoomContentRepositoryPort {
  list(roomId: string): RoomContent[];
  get(id: string): RoomContent | null;
  create(input: Omit<RoomContent, "id" | "createdAt" | "updatedAt">): RoomContent;
  update(id: string, input: Pick<RoomContent, "title" | "body" | "status" | "position">): RoomContent | null;
  delete(id: string): boolean;
}

export interface RoomRunRepositoryPort {
  listForRoom(roomId: string): RoomRun[];
  get(id: string): RoomRun | null;
  create(input: Pick<RoomRun, "roomId" | "requestText" | "projectHintId" | "contextRevision">): RoomRun;
  update(
    id: string,
    patch: Partial<Pick<RoomRun, "route" | "state" | "routerSummary" | "finalResponse" | "errorCode" | "startedAt" | "completedAt">>,
  ): RoomRun | null;
}

export interface TaskRepositoryPort {
  listForRun(runId: string): Task[];
  listForRoom(roomId: string): Task[];
  get(id: string): Task | null;
  create(input: Omit<Task, "id" | "createdAt" | "startedAt" | "completedAt" | "result">): Task;
  update(id: string, patch: Pick<Partial<Task>, "sessionId" | "state" | "result" | "startedAt" | "completedAt">): Task | null;
}

export type SessionCatalogPort = {
  getAgent(id: string): Agent | null;
  getMcp(id: string): Mcp | null;
  getProject(id: string): import("@/domain/models").Project | null;
};
