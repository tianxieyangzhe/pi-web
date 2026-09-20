import { DomainError } from "@/domain/errors";
import { projectFiles } from "@/infrastructure/projects/project-files.server";
import { dataResponse, errorResponse } from "@/shared/protocol/api";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const relativePath = new URL(request.url).searchParams.get("path");
    if (!relativePath) throw new DomainError("INVALID_PATH", "缺少文件相对路径", 400, true);
    return dataResponse(projectFiles.read((await params).projectId, relativePath));
  } catch (error) { return errorResponse(error); }
}
