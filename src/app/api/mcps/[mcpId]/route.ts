import { services } from "@/bootstrap/composition-root.server";
import { DomainError } from "@/domain/errors";
import { dataResponse, errorResponse, jsonBody } from "@/shared/protocol/api";
import { idempotentMutation } from "@/shared/protocol/idempotency.server";

export const runtime = "nodejs";
type Context = { params: Promise<{ mcpId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const mcp = services.catalog.getMcp((await params).mcpId);
    if (!mcp) throw new DomainError("NOT_FOUND", "MCP 不存在", 404, true);
    return dataResponse(mcp);
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, { params }: Context) {
  const { mcpId } = await params;
  return idempotentMutation(request, `mcps:${mcpId}:update`, async () => {
    try { return dataResponse(services.catalog.updateMcp(mcpId, await jsonBody(request))); }
    catch (error) { return errorResponse(error); }
  });
}

export async function DELETE(request: Request, { params }: Context) {
  const { mcpId } = await params;
  return idempotentMutation(request, `mcps:${mcpId}:delete`, () => {
    try { services.catalog.deleteMcp(mcpId); return dataResponse({ deleted: true }); }
    catch (error) { return errorResponse(error); }
  });
}
