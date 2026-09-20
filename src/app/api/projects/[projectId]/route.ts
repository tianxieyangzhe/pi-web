import { services } from "@/bootstrap/composition-root.server";
import { DomainError } from "@/domain/errors";
import { dataResponse, errorResponse, jsonBody } from "@/shared/protocol/api";
import { idempotentMutation } from "@/shared/protocol/idempotency.server";

export const runtime = "nodejs";
type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const project = services.catalog.getProject((await params).projectId);
    if (!project) throw new DomainError("NOT_FOUND", "项目不存在", 404, true);
    return dataResponse(project);
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, { params }: Context) {
  const { projectId } = await params;
  return idempotentMutation(request, `projects:${projectId}:update`, async () => {
    try { return dataResponse(services.catalog.updateProject(projectId, await jsonBody(request))); }
    catch (error) { return errorResponse(error); }
  });
}

export async function DELETE(request: Request, { params }: Context) {
  const { projectId } = await params;
  return idempotentMutation(request, `projects:${projectId}:delete`, () => {
    try { services.catalog.deleteProject(projectId); return dataResponse({ deleted: true }); }
    catch (error) { return errorResponse(error); }
  });
}
