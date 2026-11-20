import type {
  ImageProfile,
  NativeImageRef,
  StoredRow as Row,
} from "@/domain/images";
// Record views of the three current objects; not SQL tables or history collections.
export type ImageRecordKind =
  | "conversations"
  | "drafts"
  | "tasks"
  | "commands"
  | "plans"
  | "executions"
  | "assets"
  | "plan_inputs"
  | "draft_inputs";
export interface ImageStore {
  assertReady(): void;
  transaction<T>(fn: () => T): T;
  get(kind: ImageRecordKind, id: string): Row;
  find(kind: ImageRecordKind, where: Record<string, unknown>): Row | undefined;
  list(kind: ImageRecordKind, where?: Record<string, unknown>): Row[];
  insert(kind: ImageRecordKind, values: Row): Row;
  update(kind: ImageRecordKind, id: string, values: Row, revision?: number): Row;
  conversation(id: string): Row;
  task(id: string, conversationId?: string): Row;
  draft(conversationId: string, taskId: string | null): Row;
  createDraft(conversationId: string, taskId: string | null): Row;
  replaceDraftInputs(id: string, ids: string[]): void;
  command(kind: string, scope: string, key: string): Row | undefined;
  busyTask(id: string): Row | undefined;
  busyConversation(id: string): Row | undefined;
  interruptPreviousProcess(processStartedAt: string): void;
}
export interface ImageFiles {
  save(asset: Row, bytes: Uint8Array, beforeReady?: () => void): Promise<void>;
  remove(asset: Row): Promise<void>;
  read(asset: Row): Promise<Uint8Array>;
  inspect(bytes: Uint8Array): Promise<{
    bytes: Uint8Array;
    mime: string;
    width: number;
    height: number;
  }>;
  process(
    bytes: Uint8Array,
    target: { width: number; height: number },
    spec: unknown,
  ): Promise<Uint8Array>;
  candidates(
    taskId: string,
  ): Promise<
    Array<{ candidateId: string; name: string; sha256: string; bytes: number }>
  >;
  importCandidate(
    taskId: string,
    id: string,
    expected: string,
  ): Promise<{ bytes: Uint8Array; name: string }>;
}
export interface ImageDiscussion {
  capabilities?(): Promise<{
    provider: string | null;
    modelId: string | null;
    available: boolean;
    supportsImages?: boolean;
  }>;
  create(id: string): Promise<NativeImageRef>;
  tree(ref: NativeImageRef): unknown;
  recordInput(
    ref: NativeImageRef,
    command: Row,
    attachments: Array<{ bytes: Uint8Array; mimeType: string }>,
    evidence: (patch: Row) => void,
  ): Promise<void>;
  prompt(
    ref: NativeImageRef,
    command: Row,
    planning: unknown,
    attachments: Array<{ bytes: Uint8Array; mimeType: string }>,
    evidence: (patch: Row) => void,
    changed: () => void,
    signal: AbortSignal,
  ): Promise<string>;
  notify(
    ref: NativeImageRef,
    payload: unknown,
    evidence: (patch: Row) => void,
  ): Promise<string>;
}
export interface ImageProviders {
  configuration(): Promise<{
    profiles: ImageProfile[];
    defaultProfileId: string | null;
    concurrency: number;
  }>;
  authorize(profile: ImageProfile): Promise<void>;
  parameters(
    profile: ImageProfile,
    values: Record<string, unknown>,
  ): Record<string, unknown>;
  generate(
    profile: ImageProfile,
    operation: "generate" | "edit",
    prompt: string,
    parameters: Record<string, unknown>,
    inputs: Array<{ bytes: Uint8Array; mimeType: string }>,
    signal: AbortSignal,
  ): Promise<{ images: Uint8Array[]; responseId?: string }>;
}
