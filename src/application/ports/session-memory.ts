import type { SessionMemory } from "@/domain/session-memory";
import type { Session } from "@/domain/models";
export interface SessionMemoryRepositoryPort {
  get(id: string): SessionMemory | null;
  templates(): SessionMemory[];
  insert(memory: SessionMemory): SessionMemory;
  createSession(projectId: string, purpose: string, templateId?: string, templateETag?: string): Session;
  update(id: string, expected: string | null, mutate: (memory: SessionMemory) => void): SessionMemory;
}
