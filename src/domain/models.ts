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

export type AgentDefinition = {
  instructions: string;
  capabilities: {readFiles:boolean;writeFiles:boolean;readProjects:boolean;dispatchTasks:boolean;dispatchProjectWrites:boolean;exchangeMessages:boolean};
};
export type Agent = {
  id: EntityId; kind: "coordinator"|"project"|null; botId:string|null; projectId:string|null; sourceTemplateId:string|null;
  name:string; description:string|null; definition:AgentDefinition|null;legacySource?:string|null;
  contentSha256:string|null; markdown?:string|null;
  revision:number;status:ResourceStatus;createdAt:string;updatedAt:string;
};
export type AgentSnapshotRef = {agentId:string;revision:number;kind:"coordinator"|"project";botId:null;projectId:null;contentSha256:string;name:string;description:string|null};
/** Runtime-hydrated snapshot. The definition is loaded from the immutable Markdown version file. */
export type AgentSnapshot = AgentSnapshotRef & {definition:AgentDefinition};
export type LegacyRoleSnapshot = {agentId:string;revision:number;kind?:"coordinator"|"project";botId?:string|null;projectId?:string|null;name:string;description?:string|null;definition:AgentDefinition};
export type LegacyPiAgentSnapshot = {id:string;name:string;description?:string|null;extension:PiAgentExtension;policy:AgentPolicy;revision:number;status?:ResourceStatus;createdAt?:string;updatedAt?:string};
export type LegacyAgentSnapshot = LegacyPiAgentSnapshot | LegacyRoleSnapshot;

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
  createRequestKeyHash?: string | null;
  createRequestSha256?: string | null;
  projectId: EntityId;
  status: "open" | "closed";
  purpose: string;
  botConversationId:string|null;participantName:string|null;assignment:string|null;collaborationState:"active"|"disabled"|null;botJoinedAt:string|null;updatedAt:string;
  agentId: EntityId | null;
  agentSnapshot: AgentSnapshot | LegacyAgentSnapshot | null;
  mcpIds: EntityId[];
  mcpSnapshots: Mcp[];
  state: SessionState;
  nativeRef: JsonObject | null;
  nativeMetadata: JsonObject;
  createdAt: ISODateTime;
  lastActivityAt: ISODateTime | null;
  endedAt: ISODateTime | null;
};

export type ConversationEntry = {
  id: string;
  kind: "text" | "tool";
  text?: string;
  activity?: ActivityEvent;
};

export type ConversationMessage = {
  id: string;
  sessionId: EntityId;
  role: "user" | "assistant";
  origin?: "user" | "coordinator";
  content: string;
  createdAt: ISODateTime;
  entries?: ConversationEntry[];
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
  | {type:"context_changed"}
  | { type: "pi_event"; piType: string; payload: unknown; temporaryId: string | null }
  | { type: "entry_link"; entryId: string; temporaryId: string }
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
