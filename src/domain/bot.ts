import { createHash } from "node:crypto";
import { DomainError } from "./errors";
import type { ActivityEvent, AgentEvent, AgentSnapshot, AgentSnapshotRef } from "./models";
export type BotProjectAgentBinding = {projectId:string;agentId:string;agentRevision:number;contentSha256:string};
export type BotProjectBinding = {projectId:string;agents:AgentSnapshotRef[]};
export type Bot = {
  id: string;
  name: string;
  description: string | null;
  workingDirectory: string;
  workspaceKind: "user_selected" | "managed";
  /** API projection only; relation rows are persisted separately. */
  projectBindings?: BotProjectBinding[];
  coordinatorAgentId:string|null;
  coordinatorAgentSnapshot:AgentSnapshot|null;
  maxParallelExecutions: number;
  status: "active" | "disabled" | "archived";
  createdAt: string;
  updatedAt: string;
};
export type BotConversation = {
  id: string;
  botId: string;
  title: string;
  coordinatorAgentId:string;
  coordinatorAgentSnapshot:AgentSnapshotRef;
  nativeRef: PiNativeRef | null;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string | null;
};
export type ProjectCallStatus = "accepted" | "working" | "completed" | "aborted" | "unknown";
export type ProjectCall = {
  id: string;
  conversationId: string;
  projectId: string;
  sessionId: string | null;
  sourceEntryId: string;
  sentContent: string;
  status: ProjectCallStatus;
  startEntryId: string | null;
  endEntryId: string | null;
  createdAt: string;
  updatedAt: string;
};
export type BotConversationStats = {
  projectCount: number;
  projectAgentCandidateCount: number;
  projectSessionCount: number;
  callCount: number;
  activeCallCount: number;
  unknownCallCount: number;
};
export type BotLiveExecution = {
  executionId: string;
  conversationId: string;
  workId: string | null;
  taskId: string | null;
  targetSessionId: string | null;
  projectId: string | null;
  projectName: string | null;
  agentId: string;
  agentName: string;
  agentKind: "coordinator" | "project";
  state: "starting" | "running";
  text: string;
  activities: ActivityEvent[];
  startedAt: string;
};
export type BotLiveEvent =
  | { type: "snapshot"; executions: BotLiveExecution[] }
  | { type: "execution"; execution: BotLiveExecution }
  | { type: "delta"; executionId: string; text: string }
  | { type: "reset"; executionId: string }
  | { type: "activity"; executionId: string; activity: ActivityEvent }
  | { type: "finished"; executionId: string; state: "completed" | "failed" | "cancelled" | "unknown" }
  | { type: "event"; event: AgentEvent }
  | { type: "project_call"; callId: string; progress: "not_started" | "processing" | "finished" }
  | { type: "error"; code: string; message: string };
export type PiNativeRef = {
  kind: "pi";
  sessionFile: string;
  sessionId: string;
  cwd: string;
};
export type BotTask = {
  id: string;
  conversationId: string;
  workId: string;
  targetSessionId: string;
  title: string;
  instruction: string;
  acceptanceCriteria: string[];
  operation: BotOperation;
  creationReason:string|null;
  status: "open" | "completed" | "failed" | "cancelled";
  waitingForMessageId:string|null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  finishedAt:string|null;
};
export type BotOperation = "read" | "project_write";
export type AgentDefinitionIssue = {summary:string;evidenceEntryIds:string[]};
export type BotExecutionResult = {
  summary: string;
  verification: "passed" | "failed" | "not_run";
  checks: Array<{
    criterion: string;
    outcome: "passed" | "failed" | "not_run";
    evidence: string;
    sourceEntryIds: string[];
  }>;
  outputs: Array<{
    title: string;
    summary: string;
    path: string | null;
  }>;
  blockers: string[];
  agentDefinitionIssue?:AgentDefinitionIssue;
  workOutcome?:"completed"|"failed";
};
export type BotExecution = {
  id: string;
  conversationId: string;
  targetSessionId: string | null;
  taskId: string | null;
  workId:string|null;
  triggerMessageId:string|null;
  inputMode:"append"|"resume_received";
  resumedFromExecutionId:string|null;
  kind: "coordinator" | "task" | "interaction";
  attemptNumber: number;
  input: string;
  agentSnapshot:AgentSnapshot|null;
  assignmentSnapshot:string|null;
  operation: BotOperation;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "unknown";
  cancelRequestedAt:string|null;
  runtimeInstanceId:string|null;
  inputNativeEntryId:string|null;
  idempotencyKey: string;
  nativeStartEntryId: string | null;
  nativeEndEntryId: string | null;
  resultJson: BotExecutionResult | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};
export type BotMessage = {
  id: string;
  conversationId: string;
  workId:string|null;
  taskId: string | null;
  sourceKind: "user" | "coordinator" | "project_session" | "service";
  sourceSessionId: string | null;
  sourceExecutionId: string | null;
  targetSessionId: string | null;
  replyToMessageId: string | null;
  kind: "message" | "question" | "answer" | "result" | "intervention";
  content: string;
  deliveryMode: "when_idle" | "steer";
  deliveryStatus:"pending"|"delivering"|"delivered"|"unknown"|"cancelled";
  deliveryStartedAt:string|null;
  deliveryRuntimeInstanceId:string|null;
  withdrawRequestedAt:string|null;
  targetNativeEntryId: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
};
export type BotWork={id:string;conversationId:string;originMessageId:string;title:string;goal:string;status:"open"|"completed"|"failed"|"cancelled";finalExecutionId:string|null;idempotencyKey:string;createdAt:string;updatedAt:string;finishedAt:string|null};
export type BotDependency = {
  conversationId: string;
  taskId: string;
  dependsOnTaskId: string;
  createdAt: string;
};
export type BotTables = {
  bots: Bot;
  bot_conversations: BotConversation;
  project_calls: ProjectCall;
};
export const botInputBudget: Readonly<{maxUnicodeChars:number;maxUtf8Bytes:number;messageOverheadBytes:number}> = { maxUnicodeChars: 48_000, maxUtf8Bytes: 80_000, messageOverheadBytes: 256 };
export function botInputByteLimit(contextWindow: number, maxTokens: number) {
  const window = Number.isFinite(contextWindow) && contextWindow > 0 ? Math.floor(contextWindow) : 128_000,
    output = Number.isFinite(maxTokens) && maxTokens >= 0 ? Math.floor(maxTokens) : 16_384,
    reserve = Math.min(16_000, Math.floor(window / 4));
  return Math.max(botInputBudget.messageOverheadBytes, Math.min(botInputBudget.maxUtf8Bytes, window - output - reserve));
}
export function assertBotBudget(instructions: string, content: string, toolSchemas: unknown, maxUtf8Bytes = botInputBudget.maxUtf8Bytes) {
  const combined = instructions + content + JSON.stringify(toolSchemas);
  if ([...combined].length > botInputBudget.maxUnicodeChars || Buffer.byteLength(combined) + botInputBudget.messageOverheadBytes > maxUtf8Bytes) throw new DomainError('BOT_INPUT_TOO_LARGE', '本次协作输入超过预算，未截断或调用模型', 422, true);
}
export const activeExecutionStates: readonly BotExecution["status"][] = ["running", "unknown"];
export function botText(value: unknown, label: string, limit: number, empty = false): string {
  if (typeof value !== "string" || !empty && !value.trim() || [...value].length > limit) throw new DomainError("INVALID_BOT_INPUT", `${label}不能为空或超过 ${limit} 字符`, 422, true);
  return value.trim();
}
export function botList(value: unknown, label: string, limit = 500): string[] {
  if (!Array.isArray(value) || value.length > 20) throw new DomainError("INVALID_BOT_INPUT", `${label}最多 20 项`, 422, true);
  return value.map(x => botText(x, label, limit));
}
export function botETag(value: object) {
  return '"' + createHash("sha256").update(JSON.stringify(value)).digest("hex") + '"';
}
export function operationForBot(content: string): BotOperation {
  return /(?:修改|修复|实现|新增|创建|删除|重构|写入|替换|change|update|fix|implement|create|delete|remove|refactor|write|edit|replace)/i.test(content) ? 'project_write' : 'read';
}
export function botOperation(value: unknown): BotOperation {
  if (value !== "read" && value !== "project_write") throw new DomainError("INVALID_BOT_INPUT", "只支持读取或项目修改", 422, true);
  return value;
}
export function safeBotContent(text: string) {
  return text.replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+\S+)/gi, "[已隐藏]").replace(/((?:OPENAI|API|ACCESS|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\s*[:=]\s*)[^\s,;]+/gi, "$1[已隐藏]");
}
export function validateBotResult(value: unknown): BotExecutionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("RESULT_INVALID", "执行结果格式不正确", 422, true);
  const v = value as Record<string, unknown>;
  const keys = ["summary", "verification", "checks", "outputs", "blockers", "agentDefinitionIssue","workOutcome"];
  if (Object.keys(v).some(k => !keys.includes(k)) || !Array.isArray(v.checks) || v.checks.length > 20 || !Array.isArray(v.outputs) || v.outputs.length > 20 || !["passed", "failed", "not_run"].includes(String(v.verification))) throw new DomainError("RESULT_INVALID", "执行结果字段不正确", 422, true);
  const result: BotExecutionResult = {
    summary: botText(v.summary, "结果摘要", 4000),
    verification: v.verification as BotExecutionResult["verification"],
    checks: v.checks.map(item => {
      if (!item || typeof item !== "object" || !["passed", "failed", "not_run"].includes(item.outcome) || Object.keys(item).some(k => !["criterion", "outcome", "evidence", "sourceEntryIds"].includes(k))) throw new DomainError("RESULT_INVALID", "检查结果格式不正确", 422, true);
      return {
        criterion: botText(item.criterion, "验收条件", 500),
        outcome: item.outcome,
        evidence: botText(item.evidence, "证据", 2000, true),
        sourceEntryIds: botList(item.sourceEntryIds, "证据来源", 256)
      };
    }),
    outputs: v.outputs.map(item => {
      if (!item || typeof item !== "object" || Object.keys(item).some(k => !["title", "summary", "path"].includes(k))) throw new DomainError("RESULT_INVALID", "产出格式不正确", 422, true);
      const p = item.path == null ? null : botText(item.path, "产出路径", 512);
      if (p && (p.startsWith("/") || p.includes("\\") || p.split("/").some((x: string) => x === ".." || /^(\.env|\.git|\.ssh|\.aws|node_modules)/.test(x)))) throw new DomainError("RESULT_INVALID", "产出必须为安全相对路径", 422, true);
      return {
        title: botText(item.title, "产出标题", 120),
        summary: botText(item.summary, "产出摘要", 500),
        path: p
      };
    }),
    blockers: botList(v.blockers, "阻塞原因")
  };
  if(v.workOutcome!==undefined){
    if(!['completed','failed'].includes(String(v.workOutcome)))throw new DomainError('RESULT_INVALID','Work 结论无效',422,true);
    result.workOutcome=v.workOutcome as BotExecutionResult['workOutcome'];
  }
  if(v.agentDefinitionIssue!==undefined){
    const issue=v.agentDefinitionIssue as Record<string,unknown>;
    if(!issue||typeof issue!=="object"||Array.isArray(issue)||Object.keys(issue).some(k=>!['summary','evidenceEntryIds'].includes(k))||!Array.isArray(issue.evidenceEntryIds)||issue.evidenceEntryIds.length<1||issue.evidenceEntryIds.length>20||v.verification==='passed')throw new DomainError("RESULT_INVALID","Agent 定义疑点需要实际证据且不能通过验收",422,true);
    result.agentDefinitionIssue={summary:safeBotContent(botText(issue.summary,"Agent 定义疑点",1200,true)),evidenceEntryIds:botList(issue.evidenceEntryIds,"Agent 定义证据",256)};
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 65536) throw new DomainError("RESULT_INVALID", "执行结果超过 64KiB", 422, true);
  return result;
}
export function assertDependencyGraph(edges: BotDependency[]) {
  const graph = new Map<string, string[]>();
  for (const e of edges) {
    if (e.taskId === e.dependsOnTaskId) throw new DomainError("TASK_DEPENDENCY_CYCLE", "任务不能依赖自身", 409, true);
    graph.set(e.taskId, [...(graph.get(e.taskId) ?? []), e.dependsOnTaskId]);
  }
  const done = new Set<string>(),
    visiting = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw new DomainError("TASK_DEPENDENCY_CYCLE", "任务依赖形成循环", 409, true);
    if (done.has(id)) return;
    visiting.add(id);
    for (const next of graph.get(id) ?? []) visit(next);
    visiting.delete(id);
    done.add(id);
  }
  for (const id of graph.keys()) visit(id);
}
