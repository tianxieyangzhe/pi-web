import {botApi} from "@/shared/protocol/bot-api.server";
export const runtime="nodejs";
export const GET=(request:Request)=>botApi(request,[]);
export const POST=(request:Request)=>botApi(request,[]);
