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

export type Room = { id: string; title: string; status: string; kind: "cross_project" };
export type RoomEntry = { room: Room; projectIds: string[] };
export type RoomContent = { id: string; roomId: string; kind: string; outputKind: string | null; title: string; body: string; status: string; sourceRunId: string | null; sourceTaskId: string | null; sourceSessionId: string | null; position: number };
export type RoomRun = { id: string; roomId: string; requestText: string; projectHintId: string | null; state: string; route: string | null; routerSummary: string | null; finalResponse: string | null; errorCode: string | null };
export type Task = { id: string; roomId: string; runId: string; projectId: string; sessionId: string | null; instruction: string; acceptance: string[]; operation: string; risk: string; state: string; result: { summary: string; status?: string; artifacts?: Array<{ path: string; description: string }>; risks?: string[]; nextActions?: string[] } | null };
export type RoomView = { room: Room; scope: Array<{ projectId: string }>; projects: Project[]; runs: RoomRun[]; tasks: Task[]; sessions?: Session[]; contents?: RoomContent[] };
export type GitFileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";
export type FileEntry = { name: string; path: string; parentPath: string; type: "file" | "directory"; gitStatus?: GitFileStatus };
export type ProjectFileListing = { entries: FileEntry[]; isGitRepository: boolean; truncated: boolean };
export type FilePreview = { path: string; content: string; size: number };
export type ProjectChanges = { isGitRepository: boolean; status: string; workingPatch: string; stagedPatch: string };

export type RoomEvent =
  | { type: "run_created"; runId: string }
  | { type: "run_state"; state: string }
  | { type: "progress"; summary: string }
  | { type: "activity"; id: string; source: "router" | "session" | "direct" | "synthesizer"; kind: "thinking" | "execution"; state: "running" | "completed" | "error"; summary: string; projectId?: string }
  | { type: "response_delta"; text: string }
  | { type: "error"; code: string; message: string; recoverable: boolean }
  | { type: "complete" };
