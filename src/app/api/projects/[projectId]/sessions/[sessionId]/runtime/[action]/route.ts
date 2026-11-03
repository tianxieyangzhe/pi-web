import { services } from "@/bootstrap/composition-root.server";
import { DomainError } from "@/domain/errors";
import { dataResponse, errorResponse, jsonBody } from "@/shared/protocol/api";

export const runtime = "nodejs";
type Context = { params: Promise<{ projectId: string; sessionId: string; action: string }> };
export async function POST(request: Request, { params }: Context) {
  try {
    const { projectId, sessionId, action } = await params;
    services.projectSessions.get(projectId, sessionId);
    if (!services.execution.events) throw new DomainError("SESSION_SUBSCRIPTION_RESTART_REQUIRED", "服务尚未加载会话订阅，请重新启动服务", 503, true);
    if (action === "open") {
      const key = request.headers.get("idempotency-key")?.trim();
      if (!key || key.length > 200) throw new DomainError("INVALID_IDEMPOTENCY_KEY", "打开会话需要有效幂等键", 400, true);
      return dataResponse(await services.execution.open(sessionId, key), { headers: { "cache-control": "no-store" } });
    }
    if (action !== "pong" && action !== "close") throw new DomainError("NOT_FOUND", "操作不存在", 404, true);
    const body = await jsonBody(request);
    if (action === "pong") {
      if (typeof body.connectionId !== "string" || typeof body.challenge !== "string") throw new DomainError("INVALID_INPUT", "缺少心跳应答", 400, true);
      services.execution.events.pong(sessionId, body.connectionId, body.challenge);
      return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    }
    if (typeof body.leaseId !== "string" || !body.leaseId) throw new DomainError("INVALID_INPUT", "缺少会话使用权", 400, true);
    services.execution.closeLease(sessionId, body.leaseId);
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
