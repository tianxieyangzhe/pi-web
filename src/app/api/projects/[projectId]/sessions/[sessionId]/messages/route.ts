import { services } from "@/bootstrap/composition-root.server";
import { DomainError } from "@/domain/errors";
import { agentEventStreamResponse } from "@/shared/protocol/agent-event-stream.server";
import { dataResponse, errorResponse, jsonBody } from "@/shared/protocol/api";
import { claimStreamingMutation } from "@/shared/protocol/idempotency.server";

export const runtime = "nodejs";

type Context = { params: Promise<{ projectId: string; sessionId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { projectId, sessionId } = await params;
    services.projectSessions.get(projectId, sessionId);
    return dataResponse(await services.execution.messages(sessionId), { headers: { "cache-control": "no-store" } });
  } catch (error) { const response = errorResponse(error); response.headers.set("cache-control", "no-store"); return response; }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const { projectId, sessionId } = await params;
    services.projectSessions.get(projectId, sessionId);
    services.execution.assertLease(sessionId, request.headers.get("x-session-lease-id"));
    const body = await jsonBody(request, 12 * 1024 * 1024);
    if (services.execution.referenceContractVersion !== 6) throw new DomainError("REFERENCE_SERVICE_RESTART_REQUIRED", "服务尚未加载参考文件功能，请重启服务后重试", 503, true);
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) throw new DomainError("INVALID_INPUT", "消息不能为空", 400, true);
    const binding=services.bots.participantForSession(sessionId);
    if(binding) throw new DomainError('SESSION_ALREADY_ATTACHED','纳入协调会话的项目 Session 不能直接输入',409,true);
    if (!claimStreamingMutation(request, `projects:${projectId}:sessions:${sessionId}:messages`)) {
      throw new DomainError("TURN_ALREADY_ACCEPTED", "消息已经被项目工作线接收", 409, true);
    }
    if (request.headers.get("accept") === "application/json") return dataResponse(services.execution.accept(sessionId, content, body.references), { status: 202, headers: { "cache-control": "no-store" } });
    return agentEventStreamResponse(sessionId, services.execution.send(sessionId, content, body.operation==='read'?'read':undefined, body.references));
  } catch (error) { return errorResponse(error); }
}
