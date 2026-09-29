export type EntityId = string;
export type ISODateTime = string;
export type JsonObject = Record<string, unknown>;

export type ResourceStatus = "active" | "disabled" | "archived";
export type RoomKind = "cross_project";
export type RoomStatus = "active" | "paused" | "closed" | "archived";

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

export type Room = {
  id: EntityId;
  kind: RoomKind;
  title: string;
  status: RoomStatus;
  contextRevision: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};

export type RoomProject = {
  id: EntityId;
  roomId: EntityId;
  projectId: EntityId;
  position: number;
  createdAt: ISODateTime;
};

export type RoomContentKind =
  | "overview"
  | "goal"
  | "rule"
  | "memory"
  | "direction"
  | "decision"
  | "output";

export type RoomContentStatus =
  | "candidate"
  | "active"
  | "adopted"
  | "dismissed"
  | "draft"
  | "published"
  | "superseded"
  | "retracted";

export type RoomOutputKind = "note" | "plan" | "delivery" | "summary";

export type RoomContent = {
  id: EntityId;
  roomId: EntityId;
  kind: RoomContentKind;
  outputKind: RoomOutputKind | null;
  title: string;
  body: string;
  status: RoomContentStatus;
  sourceRunId: EntityId | null;
  sourceTaskId: EntityId | null;
  sourceSessionId: EntityId | null;
  position: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};

export type RoomRunRoute = "direct" | "single_project" | "multi_project";
export type RoomRunState =
  | "received"
  | "routing"
  | "review_pending"
  | "dispatching"
  | "running"
  | "synthesizing"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";

export type RoomRun = {
  id: EntityId;
  roomId: EntityId;
  requestText: string;
  projectHintId: EntityId | null;
  route: RoomRunRoute | null;
  state: RoomRunState;
  routerSummary: string | null;
  finalResponse: string | null;
  errorCode: string | null;
  contextRevision: number;
  createdAt: ISODateTime;
  startedAt: ISODateTime | null;
  completedAt: ISODateTime | null;
};

export type TaskState =
  | "proposed"
  | "review_pending"
  | "approved"
  | "queued"
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";
export type TaskRisk = "low" | "medium" | "high";
export type TaskOperation = "read" | "project_write" | "external_write";

export type TaskResult = {
  status: "completed" | "blocked" | "failed";
  summary: string;
  artifacts: Array<{ projectId: EntityId; path: string; description: string }>;
  risks: string[];
  nextActions: string[];
};

export type Task = {
  id: EntityId;
  roomId: EntityId;
  runId: EntityId;
  retryOfTaskId: EntityId | null;
  projectId: EntityId;
  sessionId: EntityId | null;
  agentId: EntityId | null;
  mcpIds: EntityId[];
  instruction: string;
  acceptance: string[];
  operation: TaskOperation;
  risk: TaskRisk;
  state: TaskState;
  result: TaskResult | null;
  createdAt: ISODateTime;
  startedAt: ISODateTime | null;
  completedAt: ISODateTime | null;
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
  roomId: EntityId | null;
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
  | { type: "task_result"; result: TaskResult }
  | { type: "complete" }
  | { type: "error"; code: string; message: string; recoverable: boolean };

export type AgentEventEnvelope = {
  eventId: string;
  turnId: string;
  roomId: string | null;
  sessionId: string;
  sequence: number;
  emittedAt: string;
  event: AgentEvent;
};
