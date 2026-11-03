import { services, listBotReferenceFiles } from "@/bootstrap/composition-root.server";
import { dataResponse, errorResponse, jsonBody } from "./api";
import { DomainError } from "@/domain/errors";
import { botFiles } from "@/infrastructure/bots/bot-files.server";
import { botActionId } from "@/infrastructure/database/bot-idempotency.server";
import { sessionEventResponse } from "./session-event-response.server";
const key = (request: Request) => {
  const k = request.headers.get('idempotency-key');
  if (!k) throw new DomainError('PRECONDITION_REQUIRED', '缺少动作幂等键', 428, true);
  return k;
};
export async function botApi(request: Request, segments: string[]) {
  try {
    const [botId, resource, conversationId, action] = segments;
    if (!botId) {
      if (request.method === 'GET') return dataResponse(services.bots.list());
      if (request.method === 'POST') return dataResponse(await services.bots.create(await jsonBody(request, 524288), botActionId('create-bot', key(request))), {
        status: 201
      });
    }
    if (botId && !resource && request.method === 'PATCH') return dataResponse(services.bots.updateBot(botId, await jsonBody(request, 524288), request.headers.get('if-match')));
    if (resource === 'conversations' && !conversationId) {
      if (request.method === 'GET') return dataResponse(services.bots.list().conversations.filter(x => x.botId === botId));
      if (request.method === 'POST') return dataResponse(services.bots.createConversation(botId, await jsonBody(request, 131072), botActionId('conversation:' + botId, key(request))), {
        status: 201
      });
    }
    if (resource === 'conversations' && conversationId) {
      if ((action === "events" || action === "runtime") && !services.bots.events) throw new DomainError("SESSION_SUBSCRIPTION_RESTART_REQUIRED", "服务尚未加载会话订阅，请重新启动服务", 503, true);
      if(action==='events'&&request.method==='GET'){
        const leaseId = new URL(request.url).searchParams.get("leaseId") ?? "";
        services.bots.assertLease(botId, conversationId, leaseId);
        return sessionEventResponse(request, services.bots.events, conversationId, leaseId);
      }
      if (action === "runtime" && request.method === "POST") {
        if (segments[4] === "open") return dataResponse(await services.bots.open(botId, conversationId, key(request)), { headers: { "cache-control": "no-store" } });
        const body = await jsonBody(request);
        if (segments[4] === "pong") {
          if (typeof body.connectionId !== "string" || typeof body.challenge !== "string") throw new DomainError("INVALID_INPUT", "缺少心跳应答", 400, true);
          services.bots.pong(botId, conversationId, body.connectionId, body.challenge);
        } else if (segments[4] === "close" && typeof body.leaseId === "string") services.bots.closeLease(botId, conversationId, body.leaseId);
        else throw new DomainError("INVALID_INPUT", "无效会话动作", 400, true);
        return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
      }
      const query = new URL(request.url).searchParams;
      if (action === 'files' && !segments[4] && request.method === 'GET' && query.get('purpose') === 'references') return dataResponse(listBotReferenceFiles(botId, conversationId, query.get('path') ?? ''));
      const detail = await services.bots.detail(conversationId, { calls: query.get('callsBefore') ?? undefined });
      if (!action && request.method === 'GET') return dataResponse(detail);
      if (!action && request.method === 'PATCH') return dataResponse(services.bots.updateConversation(botId, conversationId, await jsonBody(request, 131072), request.headers.get('if-match')));
      if(action==='role'&&request.method==='POST'){const body=await jsonBody(request);services.bots.configureConversation(botId,conversationId,String(body.agentId??''),request.headers.get('if-match'),typeof body.revision==='number'?body.revision:undefined,typeof body.contentSha256==='string'?body.contentSha256:undefined);return dataResponse(await services.bots.detail(conversationId));}
      if (action === 'messages') {
        if (request.method === "GET") return dataResponse(await services.bots.messages(botId, conversationId), { headers: { "cache-control": "no-store" } });
        if (request.method === 'POST') {
          const body = await jsonBody(request, 12 * 1024 * 1024);
          if (body.targetSessionId || body.sessionId || body.projectId) throw new DomainError('INVALID_BOT_INPUT', '协调输入不能指定项目目标', 422, true);
          if (services.bots.referenceContractVersion !== 7) throw new DomainError('REFERENCE_SERVICE_RESTART_REQUIRED', '服务尚未加载参考文件功能，请重启服务后重试', 503, true);
          services.bots.assertLease(botId, conversationId, request.headers.get("x-session-lease-id") ?? "");
          return dataResponse(services.bots.send(botId, conversationId, String(body.content ?? ''), key(request), undefined, body.references), { status: 202 });
        }
      }
      if (action === 'context' && request.method === 'GET') return dataResponse(await services.bots.inspect(botId, conversationId));
      if (action === 'compact' && request.method === 'POST') {
        if (segments[4] === 'cancel') services.bots.cancelCompaction(botId, conversationId);else await services.bots.compact(botId, conversationId);
        return dataResponse(await services.bots.inspect(botId, conversationId), {
          status: 202
        });
      }
      if (action === 'files' && request.method === 'GET') {
        const p = new URL(request.url).searchParams.get('path') ?? '';
        const projectRoots=services.catalog.listProjects().map(project=>project.rootPath);
        return dataResponse(segments[4] === 'content' ? botFiles.read(detail.bot.workingDirectory, p,projectRoots) : botFiles.list(detail.bot.workingDirectory, p,projectRoots));
      }
    }
    throw new DomainError('NOT_FOUND', 'Bot 接口不存在', 404, true);
  } catch (error) {
    return errorResponse(error);
  }
}
