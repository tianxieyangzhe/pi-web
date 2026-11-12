import {services} from '@/bootstrap/composition-root.server';
import {dataResponse,errorResponse} from '@/shared/protocol/api';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){try{return dataResponse(services.agentPreparation.skills());}catch(error){return errorResponse(error);}}
