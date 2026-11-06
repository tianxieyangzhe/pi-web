import { projectFileService } from "@/bootstrap/project-files.server";
import { dataResponse, errorResponse } from "@/shared/protocol/api";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const relativePath = new URL(request.url).searchParams.get("path");
    return dataResponse(projectFileService.read((await params).projectId, relativePath), {headers:{"cache-control":"no-store"}});
  } catch (error) { const response=errorResponse(error);response.headers.set("cache-control","no-store");return response; }
}
