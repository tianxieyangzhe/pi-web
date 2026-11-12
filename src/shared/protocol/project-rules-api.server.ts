import type {ProjectRuleIdentity} from '@/application/ports/project-rules';
import type {createProjectRulesService} from '@/application/project-rules-service';
import {dataResponse,errorResponse,jsonBody} from './api';
export function createProjectRulesApi(service:ReturnType<typeof createProjectRulesService>){return async(request:Request,id:ProjectRuleIdentity)=>{try{
 if(request.method==='GET')return dataResponse(service.read(id),{headers:{'cache-control':'no-store'}});
 const etag=request.headers.get('if-match')??'';
 if(request.method==='PUT')return dataResponse(service.update(id,await jsonBody(request),etag));
 if(request.method==='POST')return dataResponse(service.start(id,await jsonBody(request),etag,request.headers.get('idempotency-key')??''),{status:202,headers:{'cache-control':'no-store'}});
 if(request.method==='PATCH')return dataResponse(service.cancel(id,await jsonBody(request)));
 return new Response(null,{status:405,headers:{allow:'GET, PUT, POST, PATCH'}});
}catch(error){return errorResponse(error);}};}
