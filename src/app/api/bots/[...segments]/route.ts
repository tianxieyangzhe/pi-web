import {botApi} from "@/shared/protocol/bot-api.server";
export const runtime="nodejs";
type Context={params:Promise<{segments:string[]}>};
async function handle(request:Request,context:Context){return botApi(request,(await context.params).segments);}
export {handle as GET,handle as POST,handle as PATCH};
