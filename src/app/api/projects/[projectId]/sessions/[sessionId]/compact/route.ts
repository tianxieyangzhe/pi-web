import {services} from "@/bootstrap/composition-root.server";
import {dataResponse,errorResponse} from "@/shared/protocol/api";
import {idempotentMutation} from "@/shared/protocol/idempotency.server";
export const runtime="nodejs";
export async function POST(request:Request,{params}:{params:Promise<{projectId:string;sessionId:string}>}){const {projectId,sessionId}=await params;return idempotentMutation(request,`compact:${projectId}:${sessionId}`,async()=>{try{return dataResponse(await services.nativeContext.compact(projectId,sessionId),{status:202});}catch(error){return errorResponse(error);}});}
