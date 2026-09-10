import { NextResponse } from "next/server";
import { getRuntimeAdapter } from "@/lib/runtimes/runtime-registry.server";
import { appendMessage, createMessage, getSession, updateSession } from "@/lib/sessions/session-store.server";
import { getWorkspace } from "@/lib/workspace/workspace-manager.server";
import type { RuntimeEvent } from "@/lib/runtimes/runtime-types";

export const runtime = "nodejs";

function summarizeTitle(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return "新建会话";
  return normalized.length > 30 ? `${normalized.slice(0, 30)}…` : normalized;
}

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const session = getSession(sessionId);
  const body = await request.json() as { message?: string };
  const message = body.message?.trim();
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });
  const workspace = getWorkspace(session.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      const isFirstUserMessage = session.messages.length === 0;
      appendMessage(sessionId, createMessage("user", message));
      if (isFirstUserMessage) updateSession(sessionId, { title: summarizeTitle(message) });
      updateSession(sessionId, { status: "running" });
      send({ type: "status", status: "running" });
      try {
        const onEvent = (event: RuntimeEvent) => send(event);
        const turn = await getRuntimeAdapter(session.runtime).sendMessage(session, message, workspace.workingDirectory, onEvent);
        if (turn.runtimeSessionId) updateSession(sessionId, { runtimeSessionId: turn.runtimeSessionId });
        const response = turn.events.filter((event) => event.type === "text").map((event) => event.text).join("\n");
        if (response) appendMessage(sessionId, createMessage("assistant", response));
        updateSession(sessionId, { status: "ready" });
        send({ type: "complete", session: getSession(sessionId) });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "运行时执行失败";
        updateSession(sessionId, { status: "error" });
        send({ type: "error", message: detail, session: getSession(sessionId) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
}
