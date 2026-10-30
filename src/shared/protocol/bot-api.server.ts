import { services, listBotReferenceFiles } from "@/bootstrap/composition-root.server";
import { dataResponse, errorResponse, jsonBody } from "./api";
import { DomainError } from "@/domain/errors";
import { botFiles } from "@/infrastructure/bots/bot-files.server";
import { botActionId } from "@/infrastructure/database/bot-idempotency.server";
import type { BotLiveEvent } from "@/domain/bot";
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
      if(action==='events'&&request.method==='GET'){
        return liveEventResponse(request,listener=>services.bots.subscribeLive(botId,conversationId,listener));
      }
      const query = new URL(request.url).searchParams;
      if (action === 'files' && !segments[4] && request.method === 'GET' && query.get('purpose') === 'references') return dataResponse(listBotReferenceFiles(botId, conversationId, query.get('path') ?? ''));
      const detail = await services.bots.detail(conversationId, { calls: query.get('callsBefore') ?? undefined });
      if (!action && request.method === 'GET') return dataResponse(detail);
      if (!action && request.method === 'PATCH') return dataResponse(services.bots.updateConversation(botId, conversationId, await jsonBody(request, 131072), request.headers.get('if-match')));
      if(action==='role'&&request.method==='POST'){const body=await jsonBody(request);services.bots.configureConversation(botId,conversationId,String(body.agentId??''),request.headers.get('if-match'),typeof body.revision==='number'?body.revision:undefined,typeof body.contentSha256==='string'?body.contentSha256:undefined);return dataResponse(await services.bots.detail(conversationId));}
      if (action === 'messages') {
        if (request.method === 'GET') return dataResponse(await services.bots.messages(botId, conversationId));
        if (request.method === 'POST') {
          const body = await jsonBody(request, 12 * 1024 * 1024);
          if (body.targetSessionId || body.sessionId || body.projectId) throw new DomainError('INVALID_BOT_INPUT', '协调输入不能指定项目目标', 422, true);
          if (services.bots.referenceContractVersion !== 7) throw new DomainError('REFERENCE_SERVICE_RESTART_REQUIRED', '服务尚未加载参考文件功能，请重启服务后重试', 503, true);
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

function liveEventResponse(request:Request,subscribe:(listener:(event:BotLiveEvent)=>void)=>()=>void):Response {
  const encoder=new TextEncoder(),pending:Uint8Array[]=[];
  let controller:ReadableStreamDefaultController<Uint8Array>|null=null,closed=false,heartbeat:ReturnType<typeof setInterval>|null=null;
  const send=(event:BotLiveEvent)=>{
    if(closed)return;
    const frame=encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
    if(!controller){pending.push(frame);return;}
    try{controller.enqueue(frame);}catch{close();}
  };
  const unsubscribe=subscribe(send);
  const close=()=>{
    if(closed)return;
    closed=true;
    if(heartbeat)clearInterval(heartbeat);
    request.signal.removeEventListener('abort',close);
    unsubscribe();
    try{controller?.close();}catch{}
  };
  const stream=new ReadableStream<Uint8Array>({
    start(value){
      controller=value;
      for(const frame of pending)value.enqueue(frame);
      pending.length=0;
      heartbeat=setInterval(()=>{try{controller?.enqueue(encoder.encode(': keep-alive\n\n'));}catch{close();}},15000);
      request.signal.addEventListener('abort',close,{once:true});
      if(request.signal.aborted)close();
    },
    cancel(){close();}
  });
  return new Response(stream,{headers:{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'}});
}
