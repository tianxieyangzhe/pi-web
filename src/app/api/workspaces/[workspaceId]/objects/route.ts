import { NextResponse } from "next/server";
import { listWorkspaceObjects } from "@/lib/workspace/workspace-objects.server";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind !== "projects" && kind !== "mcp" && kind !== "agents") return NextResponse.json({ error: "Invalid object kind" }, { status: 400 });
  return NextResponse.json({ objects: listWorkspaceObjects(workspaceId, kind) });
}
