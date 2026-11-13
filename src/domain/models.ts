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

export type AgentDefinition = {
  format?: 2|3|4;
  systemPromptMode?: 'inherit'|'replace';
  mode?: "generated"|"custom";
  scope?: "global"|"project"|"workspace";
  systemPrompt?: string;
  source?: import("./assistant-document").AssistantSource|import("./assistant-document").UnifiedAssistantDefinition['source']|null;
  projects?: Array<{id:string;name:string;rules:string}>;
  workspaceRules?: string;
  /** Read-only legacy versions; new assistants never contain appended instructions. */
  instructions?: string;
  /** Legacy version decoding only; new assistant definitions omit capabilities. */
  capabilities?: {readFiles:boolean;writeFiles:boolean};
};
export type Agent = {
  id: EntityId; kind: "project"|null;  projectId:string|null; sourceTemplateId:string|null;
  name:string; description:string|null; definition:AgentDefinition|null;legacySource?:string|null;
  contentSha256:string|null; markdown?:string|null;
  revision:number;status:ResourceStatus;createdAt:string;updatedAt:string;
};
export type AgentSnapshotRef = {agentId:string;revision:number;kind:"project";projectId:null;contentSha256:string;name:string;description:string|null};
/** Runtime-hydrated snapshot. The definition is loaded from the immutable Markdown version file. */
export type AgentSnapshot = AgentSnapshotRef & {definition:AgentDefinition};
/** Display-only identity from a historical binding; never supplies runtime configuration. */
export type LegacyAgentSnapshot = {agentId:string;revision:number;name:string;legacy:true};

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
  updatedAt:string;
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
  | { type: 'run_started'; requestId: string; startedAt: string }
  | ({ type: 'run_metrics' | 'run_progress' } & import('./session-run-metrics').SessionRunMetrics)
  | {type:"context_changed"}
  | {type:"steering_cleared"}
  | { type: "pi_event"; piType: string; payload: unknown; temporaryId: string | null }
  | { type: "entry_link"; entryId: string; temporaryId: string }
  | { type: "message_delta"; text: string }
  | { type: "response_reset" }
  | ActivityEvent
  | { type: "session_state"; state: SessionState }
  | { type: "project_changes"; projectId: EntityId; summary: string; patch: string }
  | { type: "complete" }
  | { type: "error"; code: string; message: string; recoverable: boolean };
