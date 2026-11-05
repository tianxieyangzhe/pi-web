import {services} from '@/bootstrap/composition-root.server';
import {DomainError} from '@/domain/errors';
import {exactFields} from '@/application/project-session-service';
import {dataResponse,errorResponse,jsonBody} from '@/shared/protocol/api';
export const runtime='nodejs';
type Context={params:Promise<{agentId:string}>};
export async function GET(_request:Request,{params}:Context){try{const value=services.catalog.getAgent((await params).agentId);if(!value)throw new DomainError('NOT_FOUND','Agent不存在',404,true);return dataResponse(services.catalog.presentAgent(value),{headers:{'cache-control':'no-store'}});}catch(error){return errorResponse(error);}}
export async function PATCH(request:Request,{params}:Context){try{const body=await jsonBody(request);exactFields(body,['name','description','kind','definition','status']);if(!Object.keys(body).length)throw new DomainError('INVALID_INPUT','至少提供一项修改',400,true);return dataResponse(services.catalog.presentAgent(services.catalog.updateAgent((await params).agentId,{...body,writeETag:request.headers.get('if-match')})));}catch(error){return errorResponse(error);}}
export async function DELETE(request:Request,{params}:Context){try{return dataResponse(services.catalog.deleteAgent((await params).agentId,request.headers.get('if-match')??undefined));}catch(error){return errorResponse(error);}}
