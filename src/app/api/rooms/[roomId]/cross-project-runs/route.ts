import { services } from "@/bootstrap/composition-root.server";
import { DomainError } from "@/domain/errors";
import { errorResponse, jsonBody } from "@/shared/protocol/api";
import { claimStreamingMutation } from "@/shared/protocol/idempotency.server";
import { roomRunEventStreamResponse } from "@/shared/protocol/room-run-event-stream.server";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  try {
    const { roomId } = await params;
    if (!claimStreamingMutation(request, `cross-project-rooms:${roomId}:runs`)) {
      return errorResponse(new DomainError("RUN_ALREADY_ACCEPTED", "请求已经被跨项目会话接收", 409, true));
    }
    return roomRunEventStreamResponse(roomId, services.crossProjectRoomRuns.submit(roomId, await jsonBody(request)));
  } catch (error) { return errorResponse(error); }
}
