import { NextResponse } from "next/server";
import { getRuntimeAdapter } from "@/lib/runtimes/runtime-registry.server";
import { getSession, updateSession } from "@/lib/sessions/session-store.server";
import { getPrimaryRoomSession, getRoom, touchRoom, updateRoom, updateRoomSessionState } from "@/lib/rooms/room-store.server";
import { getProject } from "@/lib/workspace/workspace-data.server";
import { getWorkspace } from "@/lib/workspace/workspace-manager.server";
import type { RuntimeEvent } from "@/lib/runtimes/runtime-types";

export const runtime = "nodejs";

function summarizeTitle(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length > 30 ? `${normalized.slice(0, 30)}…` : normalized || "新建 Room";
}

export async function POST(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const room = getRoom(roomId);
  const body = await request.json() as { message?: string };
  const message = body.message?.trim();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });
  const primary = getPrimaryRoomSession(roomId);
  if (!primary) return NextResponse.json({ error: "Room session is unavailable" }, { status: 409 });
  const session = getSession(primary.session.id);
  const cwdProject = primary.session.cwdProjectId ? getProject(primary.session.cwdProjectId) : undefined;
  const workspace = getWorkspace(room.workspaceId);
  if (!session || !workspace) return NextResponse.json({ error: "Room session or Workspace is unavailable" }, { status: 409 });
  // A newly created Workspace intentionally has no Project. It remains a
  // valid Pi conversation space and uses its private workspace directory until
  // the Room explicitly binds a local Project.
  const workingDirectory = cwdProject?.localPath ?? workspace.workingDirectory;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      let streamedText = "";
      if (!primary.session.nativeSessionRef) {
        const title = summarizeTitle(message);
        updateRoom(roomId, { title });
      }
      updateSession(session.id, { status: "running" });
      updateRoomSessionState(primary.session.id, "active");
      touchRoom(roomId);
      send({ type: "status", status: "running", roomId, sessionId: session.id });
      try {
        const turn = await getRuntimeAdapter("pi").sendMessage(session, message, workingDirectory, (event: RuntimeEvent) => {
          if (event.type === "text") streamedText = event.text;
          send(event);
        });
        if (turn.runtimeSessionId) updateSession(session.id, { runtimeSessionId: turn.runtimeSessionId });
        updateSession(session.id, { status: "ready" });
        updateRoomSessionState(primary.session.id, "idle");
        touchRoom(roomId);
        send({ type: "complete", room: getRoom(roomId) });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Pi Runtime 执行失败";
        updateSession(session.id, { status: "error" });
        updateRoomSessionState(primary.session.id, "unavailable");
        send({ type: "error", message: detail, room: getRoom(roomId) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
}
