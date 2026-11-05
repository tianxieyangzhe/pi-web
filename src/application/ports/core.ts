import type {Agent,JsonObject,Mcp,Session} from "@/domain/models";

export type CreateSessionRecord = Pick<
  Session,
  "projectId" | "purpose" | "agentId" | "agentSnapshot" | "mcpIds" | "mcpSnapshots"
> & { stableId?: string; nativeRef?: JsonObject; createRequestKeyHash?: string; createRequestSha256?: string };

export interface SessionRepositoryPort {
  listForProject(projectId: string): Session[];
  get(id: string): Session | null;
  create(input: CreateSessionRecord): Session;
  updateRuntime(
    id: string,
    patch: { state?: Session["state"]; nativeRef?: JsonObject | null; nativeMetadata?: JsonObject; endedAt?: string | null },
  ): Session | null;
  setNativeRefIfAbsent(id: string, nativeRef: JsonObject): Session | null;
  markInterruptedAfterRestart(): number;
  delete(projectId: string, id: string): void;
  adoptAgent?(id: string, expected: Session, snapshot: import("@/domain/models").AgentSnapshot): Session;
}

export type SessionCatalogPort = {
  getAgent(id: string): Agent | null;
  getAgentVersion(id:string,revision:number,sha256:string):Agent|null;
  getMcp(id: string): Mcp | null;
  getProject(id: string): import("@/domain/models").Project | null;
};
