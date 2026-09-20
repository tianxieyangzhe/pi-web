import { services } from "@/bootstrap/composition-root.server";
import { dataResponse, errorResponse, jsonBody } from "@/shared/protocol/api";
import { idempotentMutation } from "@/shared/protocol/idempotency.server";

export const runtime = "nodejs";
type Context = { params: Promise<{ roomId: string; sessionId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const { roomId, sessionId } = await params;
  return idempotentMutation(request, `sessions:${sessionId}:configure`, async () => {
    try { return dataResponse(services.sessions.configure(roomId, sessionId, await jsonBody(request))); }
    catch (error) { return errorResponse(error); }
  });
}
