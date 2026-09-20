import { services } from "@/bootstrap/composition-root.server";
import { DomainError } from "@/domain/errors";
import { agentEventStreamResponse } from "@/shared/protocol/agent-event-stream.server";
import { claimStreamingMutation } from "@/shared/protocol/idempotency.server";
import { dataResponse, errorResponse, jsonBody } from "@/shared/protocol/api";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  try {
    const { roomId } = await params;
    const primary = services.sessions.list(roomId).find((session) => session.role === "primary");
    return dataResponse(primary ? await services.execution.messages(primary.id) : []);
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  try {
    const { roomId } = await params;
    const body = await jsonBody(request);
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) return errorResponse(new DomainError("INVALID_INPUT", "消息不能为空", 400, true));
    if (!claimStreamingMutation(request, `rooms:${roomId}:primary-message`)) {
      return errorResponse(new DomainError("TURN_ALREADY_ACCEPTED", "该消息已经被工作线接收", 409, true));
    }
    const session = services.sessions.getOrCreatePrimary(roomId);
    return agentEventStreamResponse(roomId, session.id, services.execution.send(session.id, content));
  } catch (error) { return errorResponse(error); }
}
