import { services } from '@/bootstrap/composition-root.server';
import { DomainError } from '@/domain/errors';
import { exactFields } from '@/application/project-session-service';
import { dataResponse,errorResponse,jsonBody } from './api';
import { sessionDownload } from '@/infrastructure/pi/session-download.server';
export type ProjectSessionContext={params:Promise<{projectId:string;sessionId:string}>};
export async function projectSessionAction(request:Request,context:ProjectSessionContext,action:string):Promise<Response> {
  try{
    const {projectId,sessionId}=await context.params;
    services.projectSessions.get(projectId,sessionId);
    const key=request.headers.get('idempotency-key')??'',lease=request.headers.get('x-session-lease-id');
    if(request.method==='GET'){
      if(action==='models')return dataResponse(await services.sessionTools.models(projectId,sessionId,lease),{headers:{'cache-control':'no-store'}});
      if(action==='context')return dataResponse(await services.nativeContext.inspect(projectId,sessionId),{headers:{'cache-control':'no-store'}});
      if(action==='messages')return dataResponse(await services.execution.messages(sessionId),{headers:{'cache-control':'no-store'}});
      if(action==='export'){
        const query=new URL(request.url).searchParams;
        if([...query.keys()].some(key=>!['format','scope'].includes(key))||query.getAll('format').length!==1||query.getAll('scope').length!==1)throw new DomainError('INVALID_INPUT','请指定唯一导出格式和范围',400,true);
        const format=query.get('format')!,scope=query.get('scope')!;
        const content=await services.sessionTools.export(projectId,sessionId,format,scope);
        return sessionDownload(content,sessionId,format as 'html'|'jsonl',scope as 'tree'|'branch',request.signal);
      }
    }
    if(action==='model'&&request.method==='PUT')return dataResponse(await services.sessionTools.switchModel(projectId,sessionId,await jsonBody(request),key,lease));
    if(request.method==='POST'){
      if(action==='messages')return dataResponse(services.sessionTools.accept(projectId,sessionId,await jsonBody(request,12*1024*1024),key,lease),{status:202});
      if(action==='fork')return dataResponse(await services.sessionTools.fork(projectId,sessionId,await jsonBody(request),key),{status:201});
      if(action==='role')return dataResponse(await services.sessionTools.adoptAgent(projectId,sessionId,await jsonBody(request),key,request.headers.get('if-match')));
      if(action==='recover')return dataResponse(await services.sessionTools.recover(projectId,sessionId,await jsonBody(request),key));
      exactFields(await jsonBody(request,65536,true),[]);
      if(action==='interrupt')return dataResponse(await services.sessionTools.interrupt(projectId,sessionId,key));
      if(action==='restore')return dataResponse(await services.sessionTools.restore(projectId,sessionId,key));
      if(action==='end')return dataResponse(await services.projectSessions.end(projectId,sessionId,key));
      if(action==='compact')return dataResponse(await services.nativeContext.compact(projectId,sessionId,key,lease),{status:202});
      if(action==='compact/cancel')return dataResponse(await services.nativeContext.cancel(projectId,sessionId,key),{status:202});
    }
    throw new DomainError('NOT_FOUND','操作不存在',404,true);
  }catch(error){const response=errorResponse(error);response.headers.set('cache-control','no-store');return response;}
}
