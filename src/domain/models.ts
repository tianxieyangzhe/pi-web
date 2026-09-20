export type EntityId = string;
export type ISODateTime = string;
export type JsonObject = Record<string, unknown>;

export type ResourceStatus = "active" | "disabled" | "archived";
export type RoomStatus = "active" | "paused" | "closed" | "archived";
export type SessionRole = "primary" | "worker";
export type SessionState =
  | "not_started"
  | "starting"
  | "idle"
  | "running"
  | "interrupting"
  | "ended"
  | "unavailable";

export type Workspace = {
  id: EntityId;
  name: string;
  description: string | null;
  status: "active" | "archived";
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};

export type Project = {
  id: EntityId;
  name: string;
  description: string | null;
  kind: "code" | "knowledge" | "general";
  rootPath: string;
  accessMode: "read" | "write";
  status: ResourceStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};

export type McpConfig =
  | { kind: "built_in"; implementation: "workspace" }
  | {
      kind: "stdio";
      command: string;
      args: string[];
      envSecretRefs: Record<string, string>;
    }
  | {
      kind: "streamable_http";
      url: string;
      authSecretRef: string | null;
    };

export type Mcp = {
  id: EntityId;
  name: string;
  description: string | null;
  config: McpConfig;
  accessPolicy: "read_only" | "approval" | "allow";
  status: ResourceStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};

export type AgentPolicy = {
  allowProjectWrite: boolean;
  allowExternalWrite: boolean;
  allowDelegation: boolean;
  maxParallelSessions: number;
};

export type PiAgentExtension = {
  instruction: string | null;
  thinkingLevel:
    | "off"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "max"
    | null;
  tools: string[] | null;
  excludeTools: string[];
  extensionSources: string[];
  skillPaths: string[];
  settings: JsonObject;
};

export type Agent = {
  id: EntityId;
  name: string;
  description: string | null;
  extension: PiAgentExtension;
  policy: AgentPolicy;
  revision: number;
  status: ResourceStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};

export type Room = {
  id: EntityId;
  workspaceId: EntityId;
  title: string;
  status: RoomStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};

export type Session = {
  id: EntityId;
  workspaceId: EntityId;
  roomId: EntityId;
  role: SessionRole;
  purpose: string | null;
  parentSessionId: EntityId | null;
  agentId: EntityId | null;
  agentSnapshot: Agent | null;
  mcpIds: EntityId[];
  mcpSnapshots: Mcp[];
  workingProjectId: EntityId | null;
  referenceProjectIds: EntityId[];
  configurationRevision: number;
  state: SessionState;
  nativeRef: JsonObject | null;
  nativeMetadata: JsonObject;
  createdAt: ISODateTime;
  lastActivityAt: ISODateTime | null;
  endedAt: ISODateTime | null;
};

export type RoomContentKind = "overview" | "goal" | "direction" | "output";
export type RoomOutputKind =
  | "note"
  | "decision"
  | "plan"
  | "delivery"
  | "summary";
export type RoomContentStatus =
  | "candidate"
  | "active"
  | "adopted"
  | "dismissed"
  | "draft"
  | "published"
  | "superseded"
  | "retracted";

export type RoomContent = {
  id: EntityId;
  roomId: EntityId;
  kind: RoomContentKind;
  outputKind: RoomOutputKind | null;
  title: string;
  body: string;
  status: RoomContentStatus;
  sourceSessionId: EntityId | null;
  position: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};

export type ConversationMessage = {
  id: string;
  sessionId: EntityId;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  toolResults?: string;
  createdAt: ISODateTime;
};

export type ActivityEvent = {
  type: "activity";
  id: string;
  kind: "thinking" | "tool" | "context";
  state: "running" | "completed" | "error";
  summary: string;
  detail?: string;
};

export type AgentEvent =
  | { type: "message_delta"; text: string }
  | ActivityEvent
  | { type: "tool_result"; toolName: string; result: unknown }
  | { type: "session_state"; state: SessionState }
  | {
      type: "project_changes";
      projectId: EntityId;
      summary: string;
      patch: string;
    }
  | {
      type: "room_content_candidate";
      candidate: {
        kind: "goal" | "direction" | "output";
        outputKind?: RoomOutputKind;
        title: string;
        body: string;
      };
    }
  | { type: "complete" }
  | { type: "error"; code: string; message: string; recoverable: boolean };

export type AgentEventEnvelope = {
  eventId: string;
  turnId: string;
  roomId: string;
  sessionId: string;
  sequence: number;
  emittedAt: string;
  event: AgentEvent;
};
