import { services } from "@/bootstrap/composition-root.server";
import { dataResponse, errorResponse, jsonBody } from "@/shared/protocol/api";
import { idempotentMutation } from "@/shared/protocol/idempotency.server";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try { return dataResponse(services.projectSessions.list((await params).projectId)); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return idempotentMutation(request, `projects:${projectId}:sessions:create`, async () => {
    try { return dataResponse(services.projectSessions.create(projectId, await jsonBody(request)), { status: 201 }); }
    catch (error) { return errorResponse(error); }
  });
}
