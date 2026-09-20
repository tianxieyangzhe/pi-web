import { services } from "@/bootstrap/composition-root.server";
import { dataResponse, errorResponse, jsonBody } from "@/shared/protocol/api";
import { idempotentMutation } from "@/shared/protocol/idempotency.server";

export const runtime = "nodejs";
type Context = { params: Promise<{ roomId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try { return dataResponse(services.sessions.list((await params).roomId)); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: Context) {
  const { roomId } = await params;
  return idempotentMutation(request, `rooms:${roomId}:sessions:create`, async () => {
    try { return dataResponse(services.sessions.create(roomId, await jsonBody(request)), { status: 201 }); }
    catch (error) { return errorResponse(error); }
  });
}
