import type { BotTables, BotDependency, BotExecutionResult, BotConversationStats, BotProjectAgentBinding, BotProjectBinding, PiNativeRef, ProjectCall, ProjectCallStatus } from "@/domain/bot";
import type { AgentEvent, ActivityEvent, AgentSnapshot } from "@/domain/models";
import type { NativeContextInspection } from "@/domain/native-context";
export interface BotRepositoryPort {
  available(): boolean;
  assertAvailable(): void;
  transaction<T>(fn: () => T): T;
  get<K extends keyof BotTables>(table: K, id: string): BotTables[K] | null;
  list<K extends keyof BotTables>(table: K, filter?: Partial<BotTables[K]>, limit?: number): BotTables[K][];
  page<K extends keyof BotTables>(table: K, filter: Partial<BotTables[K]>, before?: string, limit?: number): {
    items: BotTables[K][];
    nextCursor: string | null;
  };
  insert<K extends keyof BotTables>(table: K, value: BotTables[K]): BotTables[K];
  update<K extends keyof BotTables>(table: K, id: string, patch: Partial<BotTables[K]>, expectedState?: string): BotTables[K];
  dependencies(conversationId: string): BotDependency[];
  addDependency(value: BotDependency): void;
  replaceBotConfiguration(botId:string, projectIds:string[], bindings:BotProjectAgentBinding[], addedAt:string):void;
  botConfiguration(botId:string):BotProjectBinding[];
  snapshotBotConfiguration(botId:string,conversationId:string,addedAt:string):void;
  conversationConfiguration(conversationId:string):BotProjectBinding[];
  adoptConversationProjectAgent(conversationId:string,projectId:string,agentId:string,revision:number,sha256:string):void;
  conversationStats(conversationId:string):BotConversationStats;
  findProjectCall(conversationId:string,projectId:string,sourceEntryId:string,sentContent:string):ProjectCall|null;
  projectCalls(conversationId:string):ProjectCall[];
  updateProjectCall(id:string,expected:ProjectCallStatus,patch:Partial<Pick<ProjectCall,"sessionId"|"status"|"startEntryId"|"endEntryId">>):ProjectCall;
  isProjectAgentBound(conversationId:string,projectId:string,agentId:string,revision:number,sha256:string):boolean;
  participants(conversationId:string): Array<{id:string;botConversationId:string;participantName:string|null;assignment:string|null;collaborationState:"active"|"disabled";botJoinedAt:string;updatedAt:string}>;
  parentForSession(sessionId:string):string|null;
  updateParticipant(sessionId:string,patch:Record<string,unknown>):void;
  setSessionRole(sessionId:string,agentId:string,agentSnapshot:AgentSnapshot):void;
  deleteConversation(conversationId:string):void;
  recover(runtimeInstanceId: string, liveSessionIds?: ReadonlySet<string>): void;
}
export type BotTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
};
export type BotRuntimeInput = {
  identity: string;
  referenceContent?: import("@/domain/message-references").ReferenceContent;
  cwd: string;
  sessionDirectory?: string;
  nativeRef: PiNativeRef | null;
  instructions: string;
  tools: BotTool[];
  allowWrite: boolean;
  allowRead?: boolean;
  allowWorkOutcome?: boolean;
  kind?:"coordinator"|"task"|"interaction";
  inputMode?:"append"|"resume_received";
  triggerMessageId?:string|null;
  resumedFromExecutionId?:string|null;
  inputNativeEntryId?:string|null;
  projectSessionId?: string;
  executionId?: string;
  coordinatorExecutionIds?: ReadonlySet<string>;
  signal?: AbortSignal;
};
export type BotNativeEvidence = {
  id: string;
  text: string;
  kind: "assistant" | "tool";
  failed: boolean;
};
export interface BotRuntimePort {
  open?(input: BotRuntimeInput, onRef: (ref: PiNativeRef) => void): Promise<void>;
  close?(identity: string): Promise<void>;
  subscribe?(identity: string, listener: (event: AgentEvent) => void): () => void;
  readTree?(input: BotRuntimeInput): Promise<unknown>;
  run(input: BotRuntimeInput, content: string, onRef: (ref: PiNativeRef) => void, emit: (event: AgentEvent) => void): Promise<{
    startId: string | null;
    endId: string | null;
    evidence: BotNativeEvidence[];
    result: BotExecutionResult | null;
    messageEntryIds: Record<string, string>;
  }>;
  abort(identity: string): Promise<void>;
  steer(identity: string, content: string, messageId?: string): Promise<void>;
  inspect(input: BotRuntimeInput): Promise<NativeContextInspection>;
  compact(input: BotRuntimeInput): Promise<void>;
  cancelCompaction(identity: string): void;
  messages(input: BotRuntimeInput): Promise<Array<{
    id: string;
    role: "user" | "assistant";
    origin?: "user" | "coordinator";
    content: string;
    createdAt: string;
    executionId: string | null;
    entries?: Array<{ id: string; kind: "text" | "tool"; text?: string; activity?: ActivityEvent }>;
  }>>;
  resolve(input: BotRuntimeInput, executionId: string): Promise<{
    endId: string | null;
    evidence: BotNativeEvidence[];
    result: BotExecutionResult | null;
    messageEntryIds?: Record<string, string>;
  }>;
  resolveMessageDelivery(input:BotRuntimeInput,messageId:string):Promise<string|null>;
  projectHandle?(input: import("./pi-runtime").SessionRuntimeInput): Promise<import("@/infrastructure/pi/coordinator-bridge-plugin").ProjectSessionHandle>;
}
export interface BotWorkspacePort {
  create(botId: string, selected?: string): Promise<{
    workingDirectory: string;
    workspaceKind: "managed" | "user_selected";
  }>;
  sessionDirectory(botId: string): string;
  validate(cwd: string): Promise<void>;
}
