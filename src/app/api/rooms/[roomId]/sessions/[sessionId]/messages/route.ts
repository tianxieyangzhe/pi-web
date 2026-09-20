import { services } from "@/bootstrap/composition-root.server";
import { DomainError } from "@/domain/errors";
import { agentEventStreamResponse } from "@/shared/protocol/agent-event-stream.server";
import { claimStreamingMutation } from "@/shared/protocol/idempotency.server";
import { dataResponse, errorResponse, jsonBody } from "@/shared/protocol/api";

export const runtime = "nodejs";
type Context = { params: Promise<{ roomId: string; sessionId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { roomId, sessionId } = await params;
    const body = await jsonBody(request);
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) return errorResponse(new DomainError("INVALID_INPUT", "消息不能为空", 400, true));
    if (!claimStreamingMutation(request, `sessions:${sessionId}:message`)) {
      return errorResponse(new DomainError("TURN_ALREADY_ACCEPTED", "该消息已经被工作线接收", 409, true));
    }
    const session = services.sessions.get(roomId, sessionId);
    if (session.role !== "worker") {
      throw new DomainError("WORKER_SESSION_REQUIRED", "该接口只接受辅助工作线消息", 409, true);
    }
    return agentEventStreamResponse(roomId, sessionId, services.execution.send(sessionId, content));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const { roomId, sessionId } = await params;
    services.sessions.get(roomId, sessionId);
    return dataResponse(await services.execution.messages(sessionId));
  } catch (error) {
    return errorResponse(error);
  }
}
