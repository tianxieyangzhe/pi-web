export const runtimeTypes = ["agent", "opencode", "pi"] as const;

export type RuntimeType = (typeof runtimeTypes)[number];
export type SessionStatus = "idle" | "ready" | "running" | "error";
export type RuntimeTrace = {
  id: string;
  kind: "thinking" | "tool" | "context";
  status: "running" | "completed" | "error";
  summary: string;
  detail?: string;
};

export type RuntimeEvent =
  | { type: "text"; text: string }
  | { type: "progress"; text: string }
  | ({ type: "trace" } & RuntimeTrace)
  | { type: "file_changes"; summary: string; diff: string }
  | { type: "status"; status: SessionStatus }
  | { type: "error"; message: string };

export type SessionMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  traces?: RuntimeTrace[];
};

export type Workspace = {
  id: string;
  name: string;
  group: "项目";
  workingDirectory: string;
};

export type Session = {
  id: string;
  workspaceId: string;
  runtime: RuntimeType;
  runtimeSessionId?: string;
  title: string;
  status: SessionStatus;
  messages: SessionMessage[];
  createdAt: string;
  updatedAt: string;
};

export type RuntimeDefinition = {
  type: RuntimeType;
  name: string;
  subtitle: string;
};
