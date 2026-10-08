import {sessionMemoryResponse} from "@/shared/protocol/session-memory-response.server";
import {services} from "@/bootstrap/composition-root.server";
import {dataResponse,errorResponse,jsonBody} from "@/shared/protocol/api";
import {idempotentMutation} from "@/shared/protocol/idempotency.server";
export const runtime="nodejs";
export async function GET(request:Request,{params}:{params:Promise<{projectId:string;sessionId:string}>}){const {projectId,sessionId}=await params;const execute=async()=>{try{return sessionMemoryResponse(await services.sessionMemories.inspect(projectId,sessionId),request);}catch(error){return errorResponse(error);}};return execute();}
