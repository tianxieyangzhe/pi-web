import { NextResponse } from "next/server";
import { createRoom, listRooms } from "@/lib/rooms/room-store.server";
import { getWorkspace } from "@/lib/workspace/workspace-manager.server";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  if (!getWorkspace(workspaceId)) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  return NextResponse.json({ rooms: listRooms(workspaceId) });
}

export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  if (!getWorkspace(workspaceId)) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  const body = await request.json() as { title?: string; problemStatement?: string; projectIds?: string[]; mcpIds?: string[]; agentIds?: string[]; runtimeId?: string; activeAgentId?: string };
  return NextResponse.json({ room: createRoom({ workspaceId, ...body }) }, { status: 201 });
}
