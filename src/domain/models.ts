export type EntityId = string;
export type ISODateTime = string;
export type JsonObject = Record<string, unknown>;

export type ResourceStatus = "active" | "disabled" | "archived";
export type Project = {
  id: EntityId;
  name: string;
  description: string | null;
  kind: "code" | "knowledge" | "general";
  rootPath: string;
  status: ResourceStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};

export type McpConfig =
  | { kind: "built_in"; implementation: "workspace" }
  | { kind: "stdio"; command: string; args: string[]; envSecretRefs: Record<string, string> }
  | { kind: "streamable_http"; url: string; authSecretRef: string | null };

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
  maxParallelTasks: number;
};

export type PiAgentExtension = {
  instruction: string | null;
  thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null;
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

export type SessionState =
  | "not_started"
  | "starting"
  | "idle"
  | "running"
  | "interrupting"
  | "ended"
  | "unavailable";

export type Session = {
  id: EntityId;
  sessionMemoryId: EntityId;
  projectId: EntityId;
  purpose: string;
  agentId: EntityId | null;
  agentSnapshot: Agent | null;
  mcpIds: EntityId[];
  mcpSnapshots: Mcp[];
  state: SessionState;
  nativeRef: JsonObject | null;
  nativeMetadata: JsonObject;
  createdAt: ISODateTime;
  lastActivityAt: ISODateTime | null;
  endedAt: ISODateTime | null;
};

export type ConversationMessage = {
  id: string;
  sessionId: EntityId;
  role: "user" | "assistant";
  content: string;
  createdAt: ISODateTime;
};

export type ActivityEvent = {
  type: "activity";
  id: string;
  round?: number;
  kind: "thinking" | "tool" | "context";
  state: "running" | "completed" | "error";
  summary: string;
  detail?: string;
};

export type AgentEvent =
  | { type: "message_delta"; text: string }
  | { type: "response_reset" }
  | ActivityEvent
  | { type: "session_state"; state: SessionState }
  | { type: "project_changes"; projectId: EntityId; summary: string; patch: string }
  | { type: "complete" }
  | { type: "error"; code: string; message: string; recoverable: boolean };

export type AgentEventEnvelope = {
  eventId: string;
  turnId: string;
  sessionId: string;
  sequence: number;
  emittedAt: string;
  event: AgentEvent;
};
