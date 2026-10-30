import { DomainError } from "@/domain/errors";
import { validateSnapshot } from "@/domain/agent-definition";
import type { BotExecution, BotExecutionResult } from "@/domain/bot";
import type { BotNativeEvidence } from "../ports/bot";
export function requireExecutionSnapshot(e: BotExecution) {
  if (!e.agentSnapshot) throw new DomainError('ROLE_NOT_CONFIGURED', '旧执行缺少角色快照，请取消旧尝试后明确重试；历史已保留', 409, true);
  return validateSnapshot(e.agentSnapshot);
}
export function requireCompletionBoundary(endId: string | null, result: BotExecutionResult, evidence: BotNativeEvidence[]) {
  if (!endId) throw new DomainError('EXECUTION_UNCERTAIN', 'Pi 未提供稳定结束边界，需要核对原生历史', 409, true);
  const ids = new Set(evidence.map(e => e.id));
  if (result.checks.some(c => c.sourceEntryIds.some(id => !ids.has(id))) || result.agentDefinitionIssue?.evidenceEntryIds.some(id=>!ids.has(id))) throw new DomainError('EXECUTION_UNCERTAIN', '结果证据不属于本次执行范围，需要核对', 409, true);
}
