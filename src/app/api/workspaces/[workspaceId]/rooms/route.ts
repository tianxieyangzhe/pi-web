import { services } from "@/bootstrap/composition-root.server";
import { dataResponse, errorResponse } from "@/shared/protocol/api";
import { idempotentMutation } from "@/shared/protocol/idempotency.server";

export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    return dataResponse(services.rooms.list((await params).workspaceId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  const { workspaceId } = await params;
  return idempotentMutation(request, `workspaces:${workspaceId}:rooms:create`, () => {
    try { return dataResponse(services.rooms.create(workspaceId), { status: 201 }); }
    catch (error) { return errorResponse(error); }
  });
}
