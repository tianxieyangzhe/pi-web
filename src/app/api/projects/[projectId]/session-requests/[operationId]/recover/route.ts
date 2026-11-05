import {services} from '@/bootstrap/composition-root.server';
import {dataResponse,errorResponse,jsonBody} from '@/shared/protocol/api';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{projectId:string;operationId:string}>}){try{const {projectId,operationId}=await params;return dataResponse(await services.sessionTools.recoverCreate(projectId,operationId,await jsonBody(request),request.headers.get('idempotency-key')??undefined));}catch(error){return errorResponse(error);}}
