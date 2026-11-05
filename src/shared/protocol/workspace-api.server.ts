import type { createWorkspaceService } from '@/application/workspace-service';
import { dataResponse, errorResponse, jsonBody } from './api';
import { sessionEventResponse } from './session-event-response.server';
import { DomainError } from '@/domain/errors';
import { exactKeys } from '@/domain/workspace';
const emptyBody=(request:Request):Promise<Record<string,unknown>>=>jsonBody(request,65536,true);
export function createWorkspaceApi(service:ReturnType<typeof createWorkspaceService>) {
async function workspaceApi(request:Request,segments:string[]=[]) {
  try {
    const [workspaceId,collection,sessionId,...rest]=segments,action=rest.join('/'),method=request.method,url=new URL(request.url);
    if(!workspaceId){if(method==='GET')return dataResponse(service.list());if(method==='POST')return dataResponse(await service.save(null,await jsonBody(request),request.headers.get('idempotency-key')??''),{status:201});}
    else if(workspaceId==='directories'&&method==='GET')return dataResponse(await service.directories(url.searchParams.get('path')??undefined));
    else if(!collection){if(method==='GET')return dataResponse(service.get(workspaceId));if(method==='PUT')return dataResponse(await service.save(workspaceId,await jsonBody(request),request.headers.get('if-match')??''));}
    else if(collection==='projects'&&sessionId&&action==='files/content'&&method==='GET')return dataResponse(await service.readFile(workspaceId,sessionId,url.searchParams.get('path')??''));
    else if(collection==='projects'&&sessionId&&action==='files'&&method==='GET')return dataResponse(await service.files(workspaceId,sessionId,url.searchParams.get('path')??''));
    else if(collection==='sessions') {
      if(!sessionId){if(method==='GET')return dataResponse(service.sessions(workspaceId));if(method==='POST')return dataResponse(service.createSession(workspaceId,await jsonBody(request),request.headers.get('idempotency-key')??''),{status:201});}
      else {
        service.session(workspaceId,sessionId);
        if(!action&&method==='GET')return dataResponse(service.session(workspaceId,sessionId));
        if(!action&&method==='DELETE'){exactKeys(await emptyBody(request),[]);return dataResponse(await service.deleteSession(workspaceId,sessionId));}
        if(action==='events'&&method==='GET')return sessionEventResponse(request,service.events,sessionId,url.searchParams.get('leaseId')??'');
        if(action==='runtime/open'&&method==='POST'){exactKeys(await emptyBody(request),[]);return dataResponse(await service.open(workspaceId,sessionId));}
        if(action==='runtime/pong'&&method==='POST'){const body=await jsonBody(request);exactKeys(body,['connectionId','challenge']);service.events.pong(sessionId,String(body.connectionId??''),String(body.challenge??''));return new Response(null,{status:204});}
        if(action==='runtime/close'&&method==='POST'){const body=await jsonBody(request);exactKeys(body,['leaseId']);service.close(sessionId,String(body.leaseId??''));return new Response(null,{status:204});}
        if(action==='messages'&&method==='GET')return dataResponse(await service.messages(workspaceId,sessionId));
        if(action==='messages'&&method==='POST')return dataResponse(await service.accept(workspaceId,sessionId,await jsonBody(request,12*1024*1024),request.headers.get('idempotency-key')??'',request.headers.get('x-session-lease-id')??''),{status:202});
        if(['models','model'].includes(action)&&(typeof service.models!=='function'||typeof service.switchModel!=='function'))throw new DomainError('SERVICE_RESTART_REQUIRED','模型恢复能力已更新，请重启应用服务后重试',503,true);
        if(action==='models'&&method==='GET')return dataResponse(await service.models(workspaceId,sessionId,request.headers.get('x-session-lease-id')??''));
        if(action==='model'&&method==='PUT')return dataResponse(await service.switchModel(workspaceId,sessionId,await jsonBody(request,65536),request.headers.get('idempotency-key')??'',request.headers.get('x-session-lease-id')??''));
        if(action==='context'&&method==='GET')return dataResponse(await service.inspect(workspaceId,sessionId));
        if(method==='POST') {
          const body=await emptyBody(request);
          if(action==='recover'){exactKeys(body,['action']);return dataResponse(await service.recover(workspaceId,sessionId,String(body.action)));}
          exactKeys(body,[]);
          if(action==='interrupt')return dataResponse(await service.interrupt(workspaceId,sessionId));
          if(action==='restore')return dataResponse(await service.restore(workspaceId,sessionId));
          if(action==='end')return dataResponse(await service.end(workspaceId,sessionId));
          if(action==='compact')return dataResponse(await service.compact(workspaceId,sessionId),{status:202});
          if(action==='compact/cancel')return dataResponse(service.cancelCompact(workspaceId,sessionId));
        }
      }
    }
    throw new DomainError('NOT_FOUND','工作区接口不存在',404,true);
  }catch(error){return errorResponse(error);}
}
return async function handleWorkspaceApi(request:Request,segments:string[]=[]) { const response=await workspaceApi(request,segments);response.headers.set('cache-control',response.headers.get('content-type')?.startsWith('text/event-stream')?'no-store, no-transform':'no-store');return response; };
}
