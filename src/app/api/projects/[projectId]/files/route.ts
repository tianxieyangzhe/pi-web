import { projectFiles } from "@/infrastructure/projects/project-files.server";
import { dataResponse, errorResponse } from "@/shared/protocol/api";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const directoryPath = new URL(request.url).searchParams.get("path") ?? "";
    return dataResponse(projectFiles.list((await params).projectId, directoryPath));
  }
  catch (error) { return errorResponse(error); }
}
