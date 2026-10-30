import type { Agent, Mcp, Project } from "@/domain/models";

export interface ProjectRepositoryPort {
  list(): Project[];
  get(id: string): Project | null;
  create(input: Omit<Project, "id" | "createdAt" | "updatedAt">): Project;
  update(
    id: string,
    patch: Partial<Omit<Project, "id" | "createdAt" | "updatedAt">>,
  ): Project | null;
  delete(id: string): boolean;
  isInUse(id: string): boolean;
}

export interface McpRepositoryPort {
  list(): Mcp[];
  get(id: string): Mcp | null;
  create(input: Omit<Mcp, "id" | "createdAt" | "updatedAt">): Mcp;
  update(
    id: string,
    patch: Partial<Omit<Mcp, "id" | "createdAt" | "updatedAt">>,
  ): Mcp | null;
  delete(id: string): boolean;
  isInUse(id: string): boolean;
}

export interface AgentRepositoryPort {
  list(): Agent[];
  get(id: string): Agent | null;
  create(input: Omit<Agent, "id" | "revision" | "createdAt" | "updatedAt" | "contentSha256">): Agent;
  update(
    id: string,
    patch: Partial<Omit<Agent, "id" | "revision" | "createdAt" | "updatedAt">>,
    expected?:string,
  ): Agent | null;
  delete(id: string): boolean;
  isInUse(id: string): boolean;
  getVersion(id:string,revision:number,sha256:string):Agent|null;
}

export type CatalogDependencies = {
  projects: ProjectRepositoryPort;
  mcps: McpRepositoryPort;
  agents: AgentRepositoryPort;
  normalizeProjectRoot(value: unknown): string;
  normalizeBotOwner?:(id:string)=>void;
  getAgentVersion?:(id:string,revision:number,sha256:string)=>Agent|null;
};
