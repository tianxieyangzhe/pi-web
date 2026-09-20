import type { AgentEvent, JsonObject, Session } from "@/domain/models";

export type PiSessionHandle = object;

export type SessionRuntimeInput = {
  session: Session;
  workingDirectory: string;
  referenceDirectories: string[];
  hasWorkingProject: boolean;
  allowProjectWrite: boolean;
  delegateSession?: (purpose: string) => Promise<{ id: string }>;
};

export interface PiRuntimePort {
  getHandle(sessionId: string, input?: SessionRuntimeInput): PiSessionHandle | undefined;
  open(input: SessionRuntimeInput): Promise<{
    handle: PiSessionHandle;
    nativeRef: JsonObject;
  }>;
  restore(input: SessionRuntimeInput): Promise<PiSessionHandle>;
  send(
    handle: PiSessionHandle,
    message: string,
    emit: (event: AgentEvent) => void,
  ): Promise<void>;
  interrupt(handle: PiSessionHandle): Promise<void>;
  readMessages(input: SessionRuntimeInput): Promise<
    Array<{
      id: string;
      role: "user" | "assistant";
      content: string;
      createdAt: string;
    }>
  >;
  close(handle: PiSessionHandle): Promise<void>;
}
