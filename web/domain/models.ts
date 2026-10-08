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

export type Agent = {
  id: string;
  name: string;
  description: string | null;
  extension: { instruction: string | null; thinkingLevel: string | null; tools: string[] | null; excludeTools: string[]; extensionSources: string[]; skillPaths: string[]; settings: Record<string, unknown> };
  policy: { allowProjectWrite: boolean; allowExternalWrite: boolean; maxParallelTasks: number };
  revision: number;
  status: ResourceStatus;
};

export type Mcp = {
  id: string;
  name: string;
  description: string | null;
  config: Record<string, unknown>;
  accessPolicy: "read_only" | "approval" | "allow";
  status: ResourceStatus;
};

export type Session = {
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

export type ConversationMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  activities?: ActivityEvent[];
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
  | { type: "complete" }
  | { type: "error"; code: string; message: string; recoverable: boolean };

export type GitFileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";
export type FileEntry = { name: string; path: string; parentPath: string; type: "file" | "directory"; gitStatus?: GitFileStatus };
export type ProjectFileListing = { entries: FileEntry[]; isGitRepository: boolean; truncated: boolean };
export type FilePreview = { path: string; content: string; size: number };
export type ProjectChanges = { isGitRepository: boolean; status: string; workingPatch: string; stagedPatch: string };
