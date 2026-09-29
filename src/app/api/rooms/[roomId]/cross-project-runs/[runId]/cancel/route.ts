import { services } from "@/bootstrap/composition-root.server";
import { dataResponse, errorResponse } from "@/shared/protocol/api";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ roomId: string; runId: string }> }) {
  try {
    const { roomId, runId } = await params;
    return dataResponse(await services.crossProjectRoomRuns.cancel(roomId, runId));
  } catch (error) { return errorResponse(error); }
}
