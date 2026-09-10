import { NextResponse } from "next/server";
import { deleteWorkspaceResource, getWorkspaceResource, type EditableResourceKind, updateWorkspaceResource } from "@/lib/workspace/workspace-data.server";

function kind(value: string): EditableResourceKind | undefined { return value === "project" || value === "mcp" || value === "agent" ? value : undefined; }

export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string; kind: string; resourceId: string }> }) {
  const { workspaceId, kind: kindValue, resourceId } = await params; const resourceKind = kind(kindValue);
  const resource = resourceKind ? getWorkspaceResource(workspaceId, resourceKind, resourceId) : undefined;
  return resource ? NextResponse.json({ resource }) : NextResponse.json({ error: "资源不存在" }, { status: 404 });
}
export async function PATCH(request: Request, { params }: { params: Promise<{ workspaceId: string; kind: string; resourceId: string }> }) {
  const { workspaceId, kind: kindValue, resourceId } = await params; const resourceKind = kind(kindValue);
  if (!resourceKind) return NextResponse.json({ error: "资源类型不存在" }, { status: 404 });
  try { return NextResponse.json({ resource: updateWorkspaceResource(workspaceId, resourceKind, resourceId, await request.json() as Record<string, unknown>) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "更新资源失败" }, { status: 400 }); }
}
export async function DELETE(_request: Request, { params }: { params: Promise<{ workspaceId: string; kind: string; resourceId: string }> }) {
  const { workspaceId, kind: kindValue, resourceId } = await params; const resourceKind = kind(kindValue);
  if (!resourceKind) return NextResponse.json({ error: "资源类型不存在" }, { status: 404 });
  try { return deleteWorkspaceResource(workspaceId, resourceKind, resourceId) ? NextResponse.json({ deletedResourceId: resourceId }) : NextResponse.json({ error: "资源不存在" }, { status: 404 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "删除资源失败" }, { status: 409 }); }
}
