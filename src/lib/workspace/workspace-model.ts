/**
 * Workspace-first durable model.
 *
 * Direct resource IDs deliberately replace association tables. Runtime-native
 * state stays opaque: this model records only the reference needed to resume it.
 */

export type JsonObject = Record<string, unknown>;
export type ProjectKind = "code" | "knowledge" | "contract" | "external" | "environment";
export type ProjectLocationKind = "local_path" | "git_remote" | "api" | "none";
export type ResourceStatus = "active" | "disabled" | "archived";
export type RoomStatus = "active" | "paused" | "closed" | "archived";
export type RuntimeSessionState = "not_started" | "active" | "idle" | "ended" | "unavailable";

export type WorkspaceInspector = {
  visible: boolean;
  kind: "project" | "mcp" | "agent" | null;
  resourceId: string | null;
  openFileRefs: string[];
  expandedTreePaths: Record<string, string[]>;
};

export type WorkspaceModel = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  defaultRuntimeId: string | null;
  activeRoomId: string | null;
  inspector: WorkspaceInspector;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: string;
  workspaceId: string;
  name: string;
  kind: ProjectKind;
  locationKind: ProjectLocationKind;
  localPath: string | null;
  sourceUri: string | null;
  accessMode: "read" | "write" | "managed";
  domain: string | null;
  configuration: JsonObject;
  status: ResourceStatus;
};

export type McpServer = {
  id: string;
  workspaceId: string;
  name: string;
  transport: "stdio" | "sse" | "streamable_http" | "in_process";
  connectionConfig: JsonObject;
  secretRef: string | null;
  capabilities: JsonObject;
  allowedProjectIds: string[];
  accessPolicy: "allow" | "approval" | "read_only";
  status: "ready" | "unavailable" | "disabled";
};

export type WorkspaceAgent = {
  id: string;
  workspaceId: string;
  name: string;
  roleKind: "system" | "project" | "specialist" | "reviewer";
  instruction: string;
  defaultRuntimeId: string | null;
  allowedProjectIds: string[];
  allowedMcpIds: string[];
  executionPolicy: JsonObject;
  status: ResourceStatus;
};

export type WorkspaceRuntime = {
  id: string;
  workspaceId: string;
  name: string;
  provider: "pi";
  connectionKind: "local_sdk" | "local_process" | "remote_service";
  configuration: JsonObject;
  capabilities: JsonObject;
  status: "ready" | "unavailable" | "disabled";
};

export type Room = {
  id: string;
  workspaceId: string;
  title: string;
  problemStatement: string | null;
  summary: string | null;
  projectIds: string[];
  mcpIds: string[];
  agentIds: string[];
  runtimeId: string;
  activeAgentId: string;
  status: RoomStatus;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeSession = {
  id: string;
  workspaceId: string;
  roomId: string;
  runtimeId: string;
  agentId: string;
  cwdProjectId: string | null;
  nativeSessionRef: string | null;
  nativeMetadata: JsonObject;
  purpose: string | null;
  state: RuntimeSessionState;
  createdAt: string;
  lastActivityAt: string | null;
};

export type RoomAsset = {
  id: string;
  workspaceId: string;
  roomId: string;
  sourceRuntimeSessionId: string | null;
  kind: "evidence" | "fact" | "hypothesis" | "decision" | "deliverable" | "reference";
  title: string;
  body: string;
  provenance: JsonObject;
  scope: "room" | "workspace";
  status: "draft" | "accepted" | "superseded" | "retracted";
  createdAt: string;
};
