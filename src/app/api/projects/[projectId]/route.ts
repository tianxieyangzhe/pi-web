import {services} from '@/bootstrap/composition-root.server';
import {DomainError} from '@/domain/errors';
import {dataResponse,errorResponse,jsonBody} from '@/shared/protocol/api';
export const runtime='nodejs';
type Context={params:Promise<{projectId:string}>};
export async function GET(_request:Request,{params}:Context){try{const value=services.catalog.getProject((await params).projectId);if(!value)throw new DomainError('NOT_FOUND','项目不存在',404,true);return dataResponse(services.catalog.presentProject(value),{headers:{'cache-control':'no-store'}});}catch(error){return errorResponse(error);}}
export async function PATCH(request:Request,{params}:Context){try{return dataResponse(services.catalog.presentProject(services.catalog.updateProject((await params).projectId,await jsonBody(request),request.headers.get('if-match')??undefined)));}catch(error){return errorResponse(error);}}
export async function DELETE(request:Request,{params}:Context){try{services.catalog.deleteProject((await params).projectId,request.headers.get('if-match')??undefined);return dataResponse({deleted:true});}catch(error){return errorResponse(error);}}
