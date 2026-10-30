import {services} from "@/bootstrap/composition-root.server";
import {dataResponse,errorResponse,jsonBody} from "@/shared/protocol/api";
export const runtime="nodejs";
export async function POST(request:Request){try{return dataResponse(await services.agentPreparation.prepare(await jsonBody(request,524288),request.signal));}catch(e){return errorResponse(e);}}
