import { NextResponse } from "next/server";
import { getRuntimeAdapter } from "@/lib/runtimes/runtime-registry.server";
import { getSession, updateSession } from "@/lib/sessions/session-store.server";

export async function POST(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const session = getSession(sessionId);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  await getRuntimeAdapter(session.runtime).interrupt(sessionId);
  return NextResponse.json({ session: updateSession(sessionId, { status: "ready" }) });
}

