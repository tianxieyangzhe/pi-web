import { NextResponse } from "next/server";
import { createWorkspace, listWorkspaces } from "@/lib/workspace/workspace-manager.server";

export async function GET() {
  return NextResponse.json({ workspaces: listWorkspaces() });
}

export async function POST(request: Request) {
  const body = await request.json() as { id?: string; name?: string };
  if (!body.name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const id = body.id?.trim() || `workspace-${crypto.randomUUID()}`;
  try {
    return NextResponse.json({ workspace: createWorkspace({ id, name: body.name.trim() }) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create workspace";
    const status = message.includes("UNIQUE constraint") ? 409 : 400;
    return NextResponse.json({ error: message.includes("UNIQUE constraint") ? "Workspace ID 已存在" : message }, { status });
  }
}
