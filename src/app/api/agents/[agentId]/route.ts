import {roleETag} from "@/domain/agent-definition";
import { services } from "@/bootstrap/composition-root.server";
import { DomainError } from "@/domain/errors";
import { dataResponse, errorResponse, jsonBody } from "@/shared/protocol/api";
import { idempotentMutation } from "@/shared/protocol/idempotency.server";

export const runtime = "nodejs";
type Context = { params: Promise<{ agentId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const agent = services.catalog.getAgent((await params).agentId);
    if (!agent) throw new DomainError("NOT_FOUND", "Agent 不存在", 404, true);
    return dataResponse({...agent,writeETag:roleETag(agent)});
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, { params }: Context) {
  const { agentId } = await params;
  return idempotentMutation(request, `agents:${agentId}:update`, async () => {
    try { return dataResponse(services.catalog.updateAgent(agentId, {...await jsonBody(request,131072),writeETag:request.headers.get("if-match")})); }
    catch (error) { return errorResponse(error); }
  });
}

export async function DELETE(request: Request, { params }: Context) {
  const { agentId } = await params;
  return idempotentMutation(request, `agents:${agentId}:delete`, () => {
    try { return dataResponse(services.catalog.deleteAgent(agentId)); }
    catch (error) { return errorResponse(error); }
  });
}
