import { services } from "@/bootstrap/composition-root.server";
import { dataResponse, errorResponse } from "@/shared/protocol/api";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string; sessionId: string }> }) {
  try {
    const { projectId, sessionId } = await params;
    services.projectSessions.get(projectId, sessionId);
    if(!await services.bots.interruptSession(sessionId))await services.execution.interrupt(sessionId);
    return dataResponse(services.projectSessions.summary(projectId, sessionId));
  } catch (error) { return errorResponse(error); }
}
