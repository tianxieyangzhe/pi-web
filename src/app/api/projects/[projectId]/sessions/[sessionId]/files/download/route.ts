import { projectSessionFiles } from '@/bootstrap/session-files.server';
import { errorResponse } from '@/shared/protocol/api';
import { fileDownloadResponse } from '@/shared/protocol/file-download-response.server';

export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{projectId:string;sessionId:string}> }) {
  try {
    const {projectId,sessionId}=await params;
    const file=await projectSessionFiles.download(projectId,sessionId,new URL(request.url).searchParams.get('path'));
    return fileDownloadResponse(file);
  } catch(error) {const response=errorResponse(error);response.headers.set('cache-control','no-store');return response;}
}
