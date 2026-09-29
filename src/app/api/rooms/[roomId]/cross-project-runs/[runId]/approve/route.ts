import { services } from "@/bootstrap/composition-root.server";
import { errorResponse } from "@/shared/protocol/api";
import { roomRunEventStreamResponse } from "@/shared/protocol/room-run-event-stream.server";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ roomId: string; runId: string }> }) {
  try {
    const { roomId, runId } = await params;
    return roomRunEventStreamResponse(roomId, services.crossProjectRoomRuns.approve(roomId, runId));
  } catch (error) { return errorResponse(error); }
}
