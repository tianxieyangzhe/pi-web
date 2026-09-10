import type { RuntimeTrace, Session, SessionMessage, SessionStatus } from "@/lib/runtimes/runtime-types";
import { database } from "@/lib/storage/database.server";
import { createRuntimeSession } from "@/lib/workspace/workspace-data.server";
import { SessionManager } from "@earendil-works/pi-coding-agent";

type SessionRow = {
  id: string; workspace_id: string; room_id: string; native_session_ref: string | null;
  state: "not_started" | "active" | "idle" | "ended" | "unavailable"; created_at: string; last_activity_at: string | null;
};
const now = () => new Date().toISOString();
const stateToStatus: Record<SessionRow["state"], SessionStatus> = { not_started: "ready", active: "running", idle: "ready", ended: "idle", unavailable: "error" };

type PiMessage = {
  role?: string;
  toolName?: string;
  isError?: boolean;
  content?: string | Array<{ type?: string; text?: string; thinking?: string; id?: string; name?: string; arguments?: unknown }>;
};

function compact(value: unknown, limit = 2400) {
  const raw = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
  const redacted = raw.replace(/(api[_-]?key|authorization|token|password|secret)\s*([:=])\s*([^\s,"}]+)/gi, "$1$2 [已隐藏]");
  return redacted.length > limit ? `${redacted.slice(0, limit)}\n…已截断` : redacted;
}

function assistantTraces(entryId: string, message: PiMessage): RuntimeTrace[] {
  if (!Array.isArray(message.content)) return [];
  return message.content.flatMap<RuntimeTrace>((part, index): RuntimeTrace[] => {
    if (part.type === "thinking" && part.thinking?.trim()) {
      return [{ id: `${entryId}-thinking-${index}`, kind: "thinking" as const, status: "completed" as const, summary: "已完成思考", detail: compact(part.thinking) }];
    }
    if (part.type === "toolCall") {
      return [{ id: `${entryId}-tool-${part.id ?? index}`, kind: "tool" as const, status: "completed" as const, summary: `调用 ${part.name ?? "工具"}`, detail: compact(part.arguments ?? {}) }];
    }
    return [];
  });
}

/**
 * Pi owns the transcript in its native JSONL session. The application projects
 * only user-visible text from that source for the Room UI; it never mirrors the
 * transcript into a second database table.
 */
function readPiMessages(nativeSessionRef: string | null): SessionMessage[] {
  if (!nativeSessionRef) return [];
  try {
    const messages: SessionMessage[] = [];
    let pendingTraces: RuntimeTrace[] = [];
    for (const entry of SessionManager.open(nativeSessionRef).getEntries()) {
      if (entry.type !== "message") continue;
      const message = entry.message as PiMessage;
      if (message.role === "toolResult") {
        const content = typeof message.content === "string" ? message.content : (message.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
        pendingTraces.push({ id: `${entry.id}-result`, kind: "tool", status: message.isError ? "error" : "completed", summary: message.isError ? `执行失败：${message.toolName ?? "工具"}` : `已完成：${message.toolName ?? "工具"}`, detail: compact(content) });
        continue;
      }
      if (message.role !== "user" && message.role !== "assistant") continue;
      const content = typeof message.content === "string"
        ? message.content
        : (message.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
      const traces = message.role === "assistant" ? assistantTraces(entry.id, message) : [];
      if (!content.trim()) {
        pendingTraces.push(...traces);
        continue;
      }
      messages.push({
        id: entry.id,
        role: message.role as "user" | "assistant",
        content,
        createdAt: entry.timestamp,
        ...(message.role === "assistant" && (pendingTraces.length || traces.length) ? { traces: [...pendingTraces, ...traces] } : {}),
      });
      if (message.role === "assistant") pendingTraces = [];
    }
    return messages;
  } catch {
    // A native session can be deleted or still be being written. The room itself
    // remains usable and the next successful load will recover the transcript.
    return [];
  }
}

function mapSession(row: SessionRow): Session {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    runtime: "pi",
    runtimeSessionId: row.native_session_ref ?? undefined,
    title: "Pi 原生 Session",
    status: stateToStatus[row.state],
    messages: readPiMessages(row.native_session_ref),
    createdAt: row.created_at,
    updatedAt: row.last_activity_at ?? row.created_at,
  };
}

export function getSession(sessionId: string) {
  const row = database.prepare("SELECT id, workspace_id, room_id, native_session_ref, state, created_at, last_activity_at FROM sessions WHERE id = ?").get(sessionId) as SessionRow | undefined;
  return row ? mapSession(row) : undefined;
}
export function listSessions(workspaceId?: string) {
  const rows = workspaceId
    ? database.prepare("SELECT id, workspace_id, room_id, native_session_ref, state, created_at, last_activity_at FROM sessions WHERE workspace_id = ? ORDER BY COALESCE(last_activity_at, created_at) DESC").all(workspaceId)
    : database.prepare("SELECT id, workspace_id, room_id, native_session_ref, state, created_at, last_activity_at FROM sessions ORDER BY COALESCE(last_activity_at, created_at) DESC").all();
  return (rows as SessionRow[]).map(mapSession);
}

/** Kept for the legacy endpoint; all sessions must now be created under a Room. */
export function createSession(_workspaceId: string, _runtime: "agent" | "opencode" | "pi", _title = "新建会话"): never {
  throw new Error("Session 必须由 Room 创建；请先创建 Room 并选择 Agent 与 Runtime");
}

export function createSessionForRoom(roomId: string, agentId?: string, cwdProjectId?: string | null) {
  const session = createRuntimeSession({ roomId, agentId, cwdProjectId });
  return getSession(session.id)!;
}

/** Message persistence intentionally belongs to Pi; this only keeps the legacy API harmless. */
export function appendMessage(sessionId: string, _message: SessionMessage) { return getSession(sessionId); }
export function createMessage(role: SessionMessage["role"], content: string): SessionMessage { return { id: crypto.randomUUID(), role, content, createdAt: now() }; }

export function updateSession(sessionId: string, patch: Partial<Pick<Session, "status" | "title" | "runtimeSessionId">>) {
  const state = patch.status === "running" ? "active" : patch.status === "error" ? "unavailable" : patch.status === "idle" ? "ended" : patch.status === "ready" ? "idle" : null;
  database.prepare("UPDATE sessions SET native_session_ref = COALESCE(?, native_session_ref), state = COALESCE(?, state), last_activity_at = ? WHERE id = ?")
    .run(patch.runtimeSessionId ?? null, state, now(), sessionId);
  return getSession(sessionId);
}
