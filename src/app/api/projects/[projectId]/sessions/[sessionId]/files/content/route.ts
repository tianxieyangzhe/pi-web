import { projectSessionFiles } from '@/bootstrap/session-files.server';
import { dataResponse, errorResponse } from '@/shared/protocol/api';

export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{projectId:string;sessionId:string}> }) {
  try {
    const {projectId,sessionId}=await params;
    const file=await projectSessionFiles.preview(projectId,sessionId,new URL(request.url).searchParams.get('path'));
    return dataResponse(file,{headers:{'cache-control':'no-store'}});
  } catch(error) {const response=errorResponse(error);response.headers.set('cache-control','no-store');return response;}
}
