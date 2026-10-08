import {services} from "@/bootstrap/composition-root.server";
import {dataResponse,errorResponse,jsonBody} from "@/shared/protocol/api";
import {idempotentMutation} from "@/shared/protocol/idempotency.server";
export const runtime="nodejs";
export async function POST(request:Request,{params}:{params:Promise<{projectId:string;sessionId:string}>}){const {projectId,sessionId}=await params;const execute=async()=>{try{return dataResponse(await services.sessionMemories.regenerate(projectId,sessionId,request.headers.get("if-match"),await jsonBody(request)));}catch(error){return errorResponse(error);}};return idempotentMutation(request,`memory:summarize:${projectId}:${sessionId}`,execute);}
