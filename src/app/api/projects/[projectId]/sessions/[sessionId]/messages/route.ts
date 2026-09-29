import { services } from "@/bootstrap/composition-root.server";
import { DomainError } from "@/domain/errors";
import { agentEventStreamResponse } from "@/shared/protocol/agent-event-stream.server";
import { dataResponse, errorResponse, jsonBody } from "@/shared/protocol/api";
import { claimStreamingMutation } from "@/shared/protocol/idempotency.server";

export const runtime = "nodejs";

type Context = { params: Promise<{ projectId: string; sessionId: string }> };

function operationFor(content: string) {
  return /(?:修改|修复|实现|新增|创建|删除|重构|升级|安装|写入|替换|rename|change|update|fix|implement|create|delete|remove|refactor|install|write|edit|replace)/i.test(content)
    ? "project_write" as const
    : "read" as const;
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const { projectId, sessionId } = await params;
    services.projectSessions.get(projectId, sessionId);
    return dataResponse(await services.execution.messages(sessionId));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const { projectId, sessionId } = await params;
    services.projectSessions.get(projectId, sessionId);
    const body = await jsonBody(request);
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) throw new DomainError("INVALID_INPUT", "消息不能为空", 400, true);
    if (!claimStreamingMutation(request, `projects:${projectId}:sessions:${sessionId}:messages`)) {
      throw new DomainError("TURN_ALREADY_ACCEPTED", "消息已经被项目工作线接收", 409, true);
    }
    return agentEventStreamResponse(null, sessionId, services.execution.send(sessionId, content, operationFor(content)));
  } catch (error) { return errorResponse(error); }
}
