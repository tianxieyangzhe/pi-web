import { services } from "@/bootstrap/composition-root.server";
import { dataResponse, errorResponse } from "@/shared/protocol/api";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string; sessionId: string }> }) {
  try {
    const { projectId, sessionId } = await params;
    services.projectSessions.get(projectId,sessionId);
    services.bots.assertCanEnd(sessionId);
    await services.execution.close(sessionId);
    return dataResponse(services.projectSessions.end(projectId, sessionId));
  } catch (error) { return errorResponse(error); }
}
