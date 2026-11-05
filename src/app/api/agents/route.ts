import {services} from '@/bootstrap/composition-root.server';
import {dataResponse,errorResponse,jsonBody} from '@/shared/protocol/api';
export const runtime='nodejs';
export function GET(){try{return dataResponse(services.catalog.listAgents(),{headers:{'cache-control':'no-store'}});}catch(error){return errorResponse(error);}}
export async function POST(request:Request){try{return dataResponse(services.catalog.presentAgent(services.catalog.createAgent(await jsonBody(request))),{status:201});}catch(error){return errorResponse(error);}}
