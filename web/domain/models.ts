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
  writeETag?: string;
};

export type AgentDefinition={instructions:string;capabilities:{readFiles:boolean;writeFiles:boolean}};
export type Agent={id:string;name:string;description:string|null;kind:"project"|null;projectId:string|null;sourceTemplateId:string|null;definition:AgentDefinition|null;legacySource?:string|null;contentSha256:string|null;revision:number;status:ResourceStatus;writeETag?:string};
export type AgentSnapshot={agentId:string;name:string;description:string|null;revision:number;kind:"project";projectId:null;contentSha256:string;definition:AgentDefinition};

export type Mcp = {
  id: string;
  name: string;
  description: string | null;
  config: Record<string, unknown>;
  accessPolicy: "read_only" | "approval" | "allow";
  status: ResourceStatus;
};

export type Session = import("../../src/domain/session-preview").SessionPreview & {
  lastOpenedAt:string|null;
  id:string;projectId:string;purpose:string;agentId:string|null;
  agentSnapshot?:Omit<AgentSnapshot,'definition'>|{agentId:string;revision:number;legacy:true}|null;
  status:'open'|'closed';
  createdAt:string;updatedAt:string;writeETag:string;
  allowedActions:import('../../src/domain/session-tools').SessionActions;
  pendingOperations:Array<{operationId:string;operation:string;status:'running'|'unknown'}>;
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
export type ProjectFileListing = { path?:string;entries: FileEntry[]; isGitRepository: boolean; gitState?:'available'|'not_repository'|'unavailable';truncated: boolean };
export type { FilePreview } from "../../src/domain/file-preview";
export type ProjectChanges = { isGitRepository: boolean; status: string; workingPatch: string; stagedPatch: string; truncated:boolean };
