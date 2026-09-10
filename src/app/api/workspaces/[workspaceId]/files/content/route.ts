import { NextResponse } from "next/server";
import { readProjectFile } from "@/lib/files/file-tree.server";

export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const filePath = new URL(request.url).searchParams.get("path");
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!filePath || !projectId) return NextResponse.json({ error: "path and projectId are required" }, { status: 400 });
  try {
    return NextResponse.json(readProjectFile(workspaceId, projectId, filePath));
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法读取文件";
    return NextResponse.json({ error: message }, { status: message === "项目不存在" ? 404 : 400 });
  }
}
