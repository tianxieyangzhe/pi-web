import type { ActivityEvent, AgentEvent, JsonObject, Session } from "@/domain/models";

export type PiSessionHandle = object;

export type SessionRuntimeInput = {
  session: Session;
  workingDirectory: string;
  allowProjectWrite: boolean;
  allowProjectRead?:boolean;
  projectSession?: boolean;
  independentProjectTools?: boolean;
  coordinatorExecutionIds?: ReadonlySet<string>;
  roleInstructions?: string;
  collaborationTools?: import("./bot").BotTool[];
  executionIdentity?: string;
};

export interface PiRuntimePort {
  getHandle(sessionId: string, input?: SessionRuntimeInput): PiSessionHandle | undefined;
  open(input: SessionRuntimeInput): Promise<{ handle: PiSessionHandle; nativeRef: JsonObject }>;
  restore(input: SessionRuntimeInput): Promise<PiSessionHandle>;
  send(handle: PiSessionHandle, message: string, emit: (event: AgentEvent) => void, onAssistantStream?: () => void, references?: import("@/domain/message-references").ReferenceContent): Promise<void>;
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
