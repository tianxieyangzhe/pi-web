import {services} from '@/bootstrap/composition-root.server';
import {dataResponse,errorResponse,jsonBody} from '@/shared/protocol/api';
export const runtime='nodejs';
export function GET(request:Request){try{const query=new URL(request.url).searchParams;return dataResponse(query.get('references')==='1'?services.catalog.listReferenceAgents(Object.fromEntries([...query.entries()].filter(([key])=>key!=='references'))):services.catalog.listAgents(),{headers:{'cache-control':'no-store'}});}catch(error){return errorResponse(error);}}
export async function POST(request:Request){try{return dataResponse(services.catalog.presentAgent(services.catalog.createAgent(await jsonBody(request,1048576))),{status:201});}catch(error){return errorResponse(error);}}
