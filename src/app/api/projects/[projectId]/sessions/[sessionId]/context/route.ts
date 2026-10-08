import {services} from "@/bootstrap/composition-root.server";
import {dataResponse,errorResponse} from "@/shared/protocol/api";
export const runtime="nodejs";
export async function GET(_request:Request,{params}:{params:Promise<{projectId:string;sessionId:string}>}){try{const {projectId,sessionId}=await params;return dataResponse(await services.nativeContext.inspect(projectId,sessionId));}catch(error){return errorResponse(error);}}
