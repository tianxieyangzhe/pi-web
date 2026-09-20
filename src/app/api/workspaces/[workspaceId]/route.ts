import { services } from "@/bootstrap/composition-root.server";
import { dataResponse, errorResponse, jsonBody } from "@/shared/protocol/api";
import { idempotentMutation } from "@/shared/protocol/idempotency.server";

export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    return dataResponse(services.workspaces.get((await params).workspaceId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const { workspaceId } = await params;
  return idempotentMutation(request, `workspaces:${workspaceId}:update`, async () => {
    try { return dataResponse(services.workspaces.update(workspaceId, await jsonBody(request))); }
    catch (error) { return errorResponse(error); }
  });
}

export async function DELETE(request: Request, { params }: Context) {
  const { workspaceId } = await params;
  return idempotentMutation(request, `workspaces:${workspaceId}:delete`, () => {
    try { services.workspaces.delete(workspaceId); return dataResponse({ deleted: true }); }
    catch (error) { return errorResponse(error); }
  });
}
