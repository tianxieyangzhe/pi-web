import { services } from '@/bootstrap/composition-root.server';
import { dataResponse, errorResponse, jsonBody } from '@/shared/protocol/api';
import { exactKeys } from '@/domain/workspace';

export const runtime = 'nodejs';
export async function GET(_request:Request,{params}:{params:Promise<{projectId:string;sessionId:string}>}){try{const {projectId,sessionId}=await params;return dataResponse(services.projectSessions.summary(projectId,sessionId));}catch(error){return errorResponse(error);}}
export async function DELETE(request: Request, { params }: { params: Promise<{ projectId: string; sessionId: string }> }) {
  try {
    const { projectId, sessionId } = await params;
    exactKeys(await jsonBody(request, 65536, true), []);
    return dataResponse(await services.sessionTools.delete(projectId, sessionId), { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
