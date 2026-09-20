import type {
  Agent,
  JsonObject,
  Mcp,
  Room,
  RoomContent,
  Session,
  Workspace,
} from "@/domain/models";

export interface WorkspaceRepositoryPort {
  list(): Workspace[];
  get(id: string): Workspace | null;
  create(input: { name: string; description: string | null }): Workspace;
  update(
    id: string,
    patch: Partial<Pick<Workspace, "name" | "description" | "status">>,
  ): Workspace | null;
  delete(id: string): boolean;
}

export interface RoomRepositoryPort {
  list(workspaceId: string): Room[];
  get(id: string): Room | null;
  create(workspaceId: string, title?: string): Room;
  update(id: string, patch: Partial<Pick<Room, "title" | "status">>): Room | null;
  touch(id: string): void;
  delete(id: string): boolean;
}

export type CreateSessionRecord = Pick<
  Session,
  | "workspaceId"
  | "roomId"
  | "role"
  | "purpose"
  | "parentSessionId"
  | "agentId"
  | "agentSnapshot"
  | "mcpIds"
  | "mcpSnapshots"
  | "workingProjectId"
  | "referenceProjectIds"
>;

export interface SessionRepositoryPort {
  listForRoom(roomId: string): Session[];
  get(id: string): Session | null;
  getPrimary(roomId: string): Session | null;
  create(input: CreateSessionRecord): Session;
  updateConfiguration(
    id: string,
    input: Pick<
      Session,
      | "agentId"
      | "agentSnapshot"
      | "mcpIds"
      | "mcpSnapshots"
      | "workingProjectId"
      | "referenceProjectIds"
    >,
  ): Session | null;
  updateRuntime(
    id: string,
    patch: {
      state?: Session["state"];
      nativeRef?: JsonObject | null;
      nativeMetadata?: JsonObject;
      endedAt?: string | null;
    },
  ): Session | null;
  markInterruptedAfterRestart(): number;
}

export interface RoomContentRepositoryPort {
  list(roomId: string): RoomContent[];
  get(id: string): RoomContent | null;
  create(input: Omit<RoomContent, "id" | "createdAt" | "updatedAt">): RoomContent;
  update(
    id: string,
    input: Pick<RoomContent, "title" | "body" | "status" | "position">,
  ): RoomContent | null;
  delete(id: string): boolean;
}

export type SessionCatalogPort = {
  getAgent(id: string): Agent | null;
  getMcp(id: string): Mcp | null;
  getProject(id: string): import("@/domain/models").Project | null;
};
