import { projectFiles } from "@/infrastructure/projects/project-files.server";
import { dataResponse, errorResponse } from "@/shared/protocol/api";

export const runtime = "nodejs";
type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try { return dataResponse(projectFiles.changes((await params).projectId)); }
  catch (error) { return errorResponse(error); }
}
