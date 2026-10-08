import {services} from "@/bootstrap/composition-root.server";
import {dataResponse,errorResponse,jsonBody} from "@/shared/protocol/api";
import {idempotentMutation} from "@/shared/protocol/idempotency.server";
export const runtime="nodejs";
export async function PATCH(request:Request,{params}:{params:Promise<{projectId:string;sessionId:string}>}){const {projectId,sessionId}=await params;const execute=async()=>{try{return dataResponse(await services.sessionMemories.change(projectId,sessionId,request.headers.get("if-match"),"context",await jsonBody(request)));}catch(error){return errorResponse(error);}};return execute();}
