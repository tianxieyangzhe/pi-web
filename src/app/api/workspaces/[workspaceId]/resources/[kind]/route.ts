import { NextResponse } from "next/server";
import { createWorkspaceResource, type EditableResourceKind } from "@/lib/workspace/workspace-data.server";
import { getWorkspace } from "@/lib/workspace/workspace-manager.server";

function kind(value: string): EditableResourceKind | undefined { return value === "project" || value === "mcp" || value === "agent" ? value : undefined; }

export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string; kind: string }> }) {
  const { workspaceId, kind: kindValue } = await params; const resourceKind = kind(kindValue);
  if (!resourceKind || !getWorkspace(workspaceId)) return NextResponse.json({ error: "Workspace 或资源类型不存在" }, { status: 404 });
  try { return NextResponse.json({ resource: createWorkspaceResource(workspaceId, resourceKind, await request.json() as Record<string, unknown>) }, { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "创建资源失败" }, { status: 400 }); }
}
