import type { ActivityEvent, AgentEvent, JsonObject, Session } from "@/domain/models";

export type PiSessionHandle = object;

export type SessionRuntimeInput = {
  projectName?:string;
  assistantContext?:{key:string;prompt:string};
  session: Session;
  selectedModel?: { provider: string; modelId: string };
  workingDirectory: string;
  allowProjectWrite: boolean;
  allowProjectRead?:boolean;
  projectSession?: boolean;
  nativeCodingTools?: boolean;
  workspace?: { id: string; defaultProjectId: string; projects: import("@/domain/workspace").WorkspaceProject[]; prompt: string };
};

export interface PiRuntimePort {
  setAssistant?(handle:object,assistant:Session["agentSnapshot"],context?:SessionRuntimeInput["assistantContext"]):void;
  getHandle(sessionId: string, input?: SessionRuntimeInput): PiSessionHandle | undefined;
  isBusy?(handle: PiSessionHandle): boolean;
  refreshModel?(handle: PiSessionHandle): Promise<void>;
  subscribe?(handle: PiSessionHandle, listener: (event: AgentEvent) => void): () => void;
  open(input: SessionRuntimeInput): Promise<{ handle: PiSessionHandle; nativeRef: JsonObject }>;
  restore(input: SessionRuntimeInput): Promise<PiSessionHandle>;
  initializeProject?(input: SessionRuntimeInput, commit: (ref: JsonObject) => JsonObject): Promise<PiSessionHandle>;
  readTree?(input: SessionRuntimeInput): Promise<{ entries: Array<{ entry: unknown; label: string | null; labelTimestamp: string | null }>; activeLeafId: string | null }>;
  validateToolSearch?(): void;
  validateWebSearch?(handle: PiSessionHandle): void;
  send(handle: PiSessionHandle, message: string, emit: (event: AgentEvent) => void, onAssistantStream?: () => void, references?: import("@/domain/message-references").ReferenceContent, allowProjectWrite?: boolean, webSearch?: boolean, toolSearch?: boolean): Promise<void>;
  steer?(handle: PiSessionHandle, content: string): Promise<void>;
  steeringQueue?(handle: PiSessionHandle): readonly string[];
  interrupt(handle: PiSessionHandle): Promise<void>;
  stopForDeletion?(handle: PiSessionHandle): Promise<void>;
  readMessages(input: SessionRuntimeInput): Promise<Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    createdAt: string;
    entries?: Array<{ id: string; kind: "text" | "tool"; text?: string; activity?: ActivityEvent }>;
  }>>;
  close(handle: PiSessionHandle): Promise<void>;
}
