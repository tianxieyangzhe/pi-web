import type { WorkspaceConfiguration, WorkspaceRecord, WorkspaceSession } from "@/domain/workspace";
import type { JsonObject } from "@/domain/models";
export interface WorkspaceRepository {
  available(): boolean;
  list(): WorkspaceRecord[];
  get(id: string): WorkspaceRecord | null;
  save(id: string | null, input: WorkspaceConfiguration, credential: string): WorkspaceRecord;
  sessions(workspaceId: string): WorkspaceSession[];
  session(workspaceId: string, id: string): WorkspaceSession | null;
  createSession(workspaceId: string, defaultProjectId: string | undefined, purpose: string, key: string): WorkspaceSession;
  bindNative(workspaceId: string, id: string, ref: JsonObject): JsonObject;
  end(workspaceId: string, id: string): WorkspaceSession;
  deleteSession(workspaceId: string, id: string): void;
}
export type DirectoryListing = { path: string; parent: string | null; directories: Array<{ name: string; path: string }> };
export interface WorkspaceDirectories {
  normalize(path: string): Promise<string>;
  list(path?: string): Promise<DirectoryListing>;
}
