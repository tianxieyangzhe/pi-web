import { NextResponse } from "next/server";
import { listSessions } from "@/lib/sessions/session-store.server";

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? undefined;
  return NextResponse.json({ sessions: listSessions(workspaceId) });
}

export async function POST(request: Request) {
  void request;
  return NextResponse.json({ error: "Session 必须由 Room 创建；请使用 /api/workspaces/:workspaceId/rooms" }, { status: 409 });
}
