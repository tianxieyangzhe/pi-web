import {services} from "@/bootstrap/composition-root.server";
import {dataResponse,errorResponse,jsonBody} from "@/shared/protocol/api";
export const runtime="nodejs";
export async function POST(request:Request,{params}:{params:Promise<{projectId:string;sessionId:string}>}){try{const {projectId,sessionId}=await params,body=await jsonBody(request);services.bots.configureSession(projectId,sessionId,String(body.agentId??''),request.headers.get('if-match'),typeof body.revision==='number'?body.revision:undefined,typeof body.contentSha256==='string'?body.contentSha256:undefined);return dataResponse(services.projectSessions.summary(projectId,sessionId));}catch(e){return errorResponse(e);}}
