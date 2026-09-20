import { services } from "@/bootstrap/composition-root.server";
import { dataResponse, errorResponse, jsonBody } from "@/shared/protocol/api";
import { idempotentMutation } from "@/shared/protocol/idempotency.server";

export const runtime = "nodejs";
type Context = { params: Promise<{ roomId: string; contentId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const { roomId, contentId } = await params;
  return idempotentMutation(request, `room-contents:${contentId}:update`, async () => {
    try { return dataResponse(services.roomContents.update(roomId, contentId, await jsonBody(request))); }
    catch (error) { return errorResponse(error); }
  });
}

export async function DELETE(request: Request, { params }: Context) {
  const { roomId, contentId } = await params;
  return idempotentMutation(request, `room-contents:${contentId}:delete`, () => {
    try { services.roomContents.delete(roomId, contentId); return dataResponse({ deleted: true }); }
    catch (error) { return errorResponse(error); }
  });
}
