import { projectFileService } from '@/bootstrap/project-files.server';
import { fileDownloadResponse } from '@/shared/protocol/file-download-response.server';
import { errorResponse } from '@/shared/protocol/api';

export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try { return fileDownloadResponse(projectFileService.download((await params).projectId, new URL(request.url).searchParams.get('path'))); }
  catch (error) { const response = errorResponse(error); response.headers.set('cache-control', 'no-store'); return response; }
}
