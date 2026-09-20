import { services } from "@/bootstrap/composition-root.server";
import { dataResponse, errorResponse, jsonBody } from "@/shared/protocol/api";
import { idempotentMutation } from "@/shared/protocol/idempotency.server";

export const runtime = "nodejs";

type Context = { params: Promise<{ roomId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    return dataResponse(services.rooms.view((await params).roomId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const { roomId } = await params;
  return idempotentMutation(request, `rooms:${roomId}:update`, async () => {
    try { return dataResponse(services.rooms.update(roomId, await jsonBody(request))); }
    catch (error) { return errorResponse(error); }
  });
}

export async function DELETE(request: Request, { params }: Context) {
  const { roomId } = await params;
  return idempotentMutation(request, `rooms:${roomId}:delete`, () => {
    try { services.rooms.delete(roomId); return dataResponse({ deleted: true }); }
    catch (error) { return errorResponse(error); }
  });
}
