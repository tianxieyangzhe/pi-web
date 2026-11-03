import { DomainError } from "@/domain/errors";
import { services } from "@/bootstrap/composition-root.server";
import { errorResponse } from "@/shared/protocol/api";
import { sessionEventResponse } from "@/shared/protocol/session-event-response.server";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string; sessionId: string }> }) {
  try {
    const { projectId, sessionId } = await params;
    services.projectSessions.get(projectId, sessionId);
    if (!services.execution.events) throw new DomainError("SESSION_SUBSCRIPTION_RESTART_REQUIRED", "服务尚未加载会话订阅，请重新启动服务", 503, true);
    const leaseId = new URL(request.url).searchParams.get("leaseId") ?? "";
    services.execution.assertLease(sessionId, leaseId);
    return sessionEventResponse(request, services.execution.events, sessionId, leaseId);
  } catch (error) { const response = errorResponse(error); response.headers.set("cache-control", "no-store"); return response; }
}
