import { services } from '@/bootstrap/composition-root.server';
import { dataResponse, errorResponse } from '@/shared/protocol/api';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{skillId:string}>}) {
  try{return dataResponse(services.agentPreparation.skill((await params).skillId));}
  catch(error){return errorResponse(error);}
}
