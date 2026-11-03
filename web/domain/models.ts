export type ResourceStatus = "active" | "disabled" | "archived";
export type Project = {
  id: string;
  name: string;
  description: string | null;
  kind: "code" | "knowledge" | "general";
  status: "active" | "disabled" | "archived";
  rootPath: string;
  createdAt?: string;
  updatedAt?: string;
};

export type AgentDefinition={instructions:string;capabilities:{readFiles:boolean;writeFiles:boolean;readProjects:boolean;dispatchTasks:boolean;dispatchProjectWrites:boolean;exchangeMessages:boolean}};
export type Agent={id:string;name:string;description:string|null;kind:"coordinator"|"project"|null;botId:string|null;projectId:string|null;sourceTemplateId:string|null;definition:AgentDefinition|null;legacySource?:string|null;contentSha256:string|null;revision:number;status:ResourceStatus;writeETag?:string};
export type AgentSnapshot={agentId:string;name:string;description:string|null;revision:number;kind:"coordinator"|"project";botId:null;projectId:null;contentSha256:string;definition:AgentDefinition};

export type Mcp = {
  id: string;
  name: string;
  description: string | null;
  config: Record<string, unknown>;
  accessPolicy: "read_only" | "approval" | "allow";
  status: ResourceStatus;
};

export type RoleState={configured:boolean;available:boolean;boundRevision:number|null;currentRevision:number|null;name:string|null;status:ResourceStatus|null;canAdoptLatest:boolean;reason:string|null};

export type Session = {
  roleState?:RoleState|null;
  writeETag:string;agentId:string|null;agentSnapshot?:AgentSnapshot|null;
  botParent?:{botId:string;conversationId:string;conversationTitle:string;sessionId:string;schedulingMode?:'enabled'|'paused';available?:boolean;reason?:string|null}|null;
  memorySummary?: string;
  sessionMemoryId: string;
  id: string;
  projectId: string;
  purpose: string;
  state: "not_started" | "starting" | "idle" | "running" | "interrupting" | "ended" | "unavailable";
  createdAt: string;
  lastActivityAt: string | null;
  endedAt: string | null;
  agent: { name: string; revision: number; thinkingLevel: string | null; skills: string[] } | null;
  mcps: Array<{ id: string; name: string; accessPolicy: "read_only" | "approval" | "allow" }>;
};

export type ConversationEntry = {
  id: string;
  kind: "text" | "tool";
  text?: string;
  activity?: ActivityEvent;
};

export type ConversationMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  origin?: "user" | "coordinator";
  content: string;
  createdAt: string;
  activities?: ActivityEvent[];
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

export type SessionTree = { entries: Array<{ entry: Record<string, unknown> & { id: string; parentId: string | null; type: string; timestamp: string }; label: string | null; labelTimestamp: string | null }>; activeLeafId: string | null };
export type PiStreamEvent = { sessionId: string; runId: string | null; sequence: number | null; type: string; entryId: string | null; temporaryId: string | null; payload: unknown };

export type AgentEvent =
  | { type: "message_delta"; text: string }
  | { type: "response_reset" }
  | ActivityEvent
  | { type: "complete" }
  | { type: "error"; code: string; message: string; recoverable: boolean };

export type GitFileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";
export type FileEntry = { name: string; path: string; parentPath: string; type: "file" | "directory"; gitStatus?: GitFileStatus };
export type ProjectFileListing = { entries: FileEntry[]; isGitRepository: boolean; truncated: boolean };
export type FilePreview = { path: string; content: string; size: number };
export type ProjectChanges = { isGitRepository: boolean; status: string; workingPatch: string; stagedPatch: string };
