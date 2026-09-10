import { NextResponse } from "next/server";
import { deleteWorkspace, getWorkspace } from "@/lib/workspace/workspace-manager.server";
import { listSessions } from "@/lib/sessions/session-store.server";

export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  return NextResponse.json({ workspace, sessions: listSessions(workspaceId) });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  try {
    if (!deleteWorkspace(workspaceId)) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    return NextResponse.json({ deletedWorkspaceId: workspaceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "项目删除失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
