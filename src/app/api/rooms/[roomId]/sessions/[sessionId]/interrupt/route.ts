import { services } from "@/bootstrap/composition-root.server";
import { dataResponse, errorResponse } from "@/shared/protocol/api";
import { idempotentMutation } from "@/shared/protocol/idempotency.server";

export const runtime = "nodejs";
type Context = { params: Promise<{ roomId: string; sessionId: string }> };

export async function POST(request: Request, { params }: Context) {
  const { roomId, sessionId } = await params;
  return idempotentMutation(request, `sessions:${sessionId}:interrupt`, async () => {
    try { services.sessions.get(roomId, sessionId); await services.execution.interrupt(sessionId); return dataResponse(services.sessions.get(roomId, sessionId)); }
    catch (error) { return errorResponse(error); }
  });
}
