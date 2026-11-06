import type { ActivityEvent, AgentEvent, JsonObject, Session } from "@/domain/models";

export type PiSessionHandle = object;

export type SessionRuntimeInput = {
  session: Session;
  selectedModel?: { provider: string; modelId: string };
  workingDirectory: string;
  allowProjectWrite: boolean;
  allowProjectRead?:boolean;
  projectSession?: boolean;
  independentProjectTools?: boolean;
  coordinatorExecutionIds?: ReadonlySet<string>;
  roleInstructions?: string;
  collaborationTools?: import("./bot").BotTool[];
  executionIdentity?: string;
  workspace?: { id: string; defaultProjectId: string; projects: import("@/domain/workspace").WorkspaceProject[]; prompt: string };
};

export interface PiRuntimePort {
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
  interrupt(handle: PiSessionHandle): Promise<void>;
  projectHandle?(input: SessionRuntimeInput): Promise<import("@/infrastructure/pi/coordinator-bridge-plugin").ProjectSessionHandle>;
  readMessages(input: SessionRuntimeInput): Promise<Array<{
    id: string;
    role: "user" | "assistant";
    origin?: "user" | "coordinator";
    content: string;
    createdAt: string;
    entries?: Array<{ id: string; kind: "text" | "tool"; text?: string; activity?: ActivityEvent }>;
  }>>;
  close(handle: PiSessionHandle): Promise<void>;
}
