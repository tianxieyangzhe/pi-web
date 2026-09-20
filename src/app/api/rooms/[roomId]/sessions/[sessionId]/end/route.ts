import { services } from "@/bootstrap/composition-root.server";
import { dataResponse, errorResponse } from "@/shared/protocol/api";
import { idempotentMutation } from "@/shared/protocol/idempotency.server";

export const runtime = "nodejs";
type Context = { params: Promise<{ roomId: string; sessionId: string }> };

export async function POST(request: Request, { params }: Context) {
  const { roomId, sessionId } = await params;
  return idempotentMutation(request, `sessions:${sessionId}:end`, async () => {
    try { await services.execution.close(sessionId); return dataResponse(services.sessions.end(roomId, sessionId)); }
    catch (error) { return errorResponse(error); }
  });
}
