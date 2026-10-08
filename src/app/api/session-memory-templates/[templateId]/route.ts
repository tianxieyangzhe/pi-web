import {services} from "@/bootstrap/composition-root.server";
import {dataResponse,errorResponse,jsonBody} from "@/shared/protocol/api";
import {DomainError} from "@/domain/errors";
export const runtime="nodejs";
type Context={params:Promise<{templateId:string}>};
export async function GET(_request:Request,{params}:Context){try{const {templateId}=await params;const result=services.sessionMemories.templates().find(x=>x.sessionMemory.id===templateId);if(!result)throw new DomainError("NOT_FOUND","模板不存在",404,true);return dataResponse(result);}catch(error){return errorResponse(error);}}
export async function PATCH(request:Request,{params}:Context){try{return dataResponse(services.sessionMemories.saveTemplate((await params).templateId,request.headers.get("if-match"),await jsonBody(request)));}catch(error){return errorResponse(error);}}
