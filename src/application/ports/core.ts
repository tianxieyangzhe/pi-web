import type {Agent,JsonObject,Mcp,Session} from "@/domain/models";

export type CreateSessionRecord = Pick<
  Session,
  "projectId" | "purpose" | "agentId" | "agentSnapshot" | "mcpIds" | "mcpSnapshots"
> & { sessionMemoryId: string;stableId?:string };

export interface SessionRepositoryPort {
  listForProject(projectId: string): Session[];
  get(id: string): Session | null;
  create(input: CreateSessionRecord): Session;
  updateRuntime(
    id: string,
    patch: { state?: Session["state"]; nativeRef?: JsonObject | null; nativeMetadata?: JsonObject; endedAt?: string | null },
  ): Session | null;
  markInterruptedAfterRestart(): number;
}

export type SessionCatalogPort = {
  getAgent(id: string): Agent | null;
  getAgentVersion(id:string,revision:number,sha256:string):Agent|null;
  getMcp(id: string): Mcp | null;
  getProject(id: string): import("@/domain/models").Project | null;
};
