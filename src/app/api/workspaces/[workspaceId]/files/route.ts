import { NextResponse } from "next/server";
import { listProjectFiles } from "@/lib/files/file-tree.server";

export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  try {
    const includeHidden = new URL(_request.url).searchParams.get("includeHidden") === "true";
    const projectId = new URL(_request.url).searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    return NextResponse.json(listProjectFiles(workspaceId, projectId, includeHidden));
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法读取项目文件";
    return NextResponse.json({ error: message }, { status: message === "项目不存在" ? 404 : 400 });
  }
}
