import { database } from "@/lib/storage/database.server";
import { createRuntimeSession, createWorkspaceRoom, getWorkspaceRoom, listRuntimeSessions, listWorkspaceRooms, updateRuntimeSessionNativeRef } from "@/lib/workspace/workspace-data.server";
import type { Room as ModelRoom, RuntimeSession } from "@/lib/workspace/workspace-model";

export type RoomStatus = ModelRoom["status"];
export type RoomSessionState = RuntimeSession["state"];
export type Room = ModelRoom & { sessions: RuntimeSession[] };

function withSessions(room: ModelRoom): Room { return { ...room, sessions: listRuntimeSessions(room.id) }; }
export function listRooms(workspaceId: string) { return listWorkspaceRooms(workspaceId).map(withSessions); }
export function getRoom(roomId: string) { const room = getWorkspaceRoom(roomId); return room ? withSessions(room) : undefined; }

/** A Room has direct project/MCP/Agent IDs. Its first Pi Session is lazy-created on first prompt. */
export function createRoom(input: { workspaceId: string; title?: string; summary?: string; projectIds?: string[]; mcpIds?: string[]; agentIds?: string[]; runtimeId?: string; activeAgentId?: string }) {
  return withSessions(createWorkspaceRoom(input));
}

export function getPrimaryRoomSession(roomId: string) {
  const room = getWorkspaceRoom(roomId);
  if (!room) return undefined;
  let session = listRuntimeSessions(roomId).find((item) => item.agentId === room.activeAgentId && item.state !== "ended");
  if (!session) session = createRuntimeSession({ roomId, agentId: room.activeAgentId, purpose: "Room 主对话" });
  return { session, room };
}

export function updateRoomSessionState(sessionId: string, state: RoomSessionState) { return updateRuntimeSessionNativeRef(sessionId, { state }); }
export function updateRoomSessionNativeRef(sessionId: string, nativeSessionRef: string) { return updateRuntimeSessionNativeRef(sessionId, { nativeSessionRef }); }
export function touchRoom(roomId: string) { database.prepare("UPDATE rooms SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), roomId); }

export function updateRoom(roomId: string, patch: Partial<Pick<ModelRoom, "title" | "summary" | "status">>) {
  database.prepare("UPDATE rooms SET title = COALESCE(?, title), summary = COALESCE(?, summary), status = COALESCE(?, status), updated_at = ? WHERE id = ?")
    .run(patch.title ?? null, patch.summary ?? null, patch.status ?? null, new Date().toISOString(), roomId);
  return getRoom(roomId);
}

export function deleteRoom(roomId: string) {
  const room = getWorkspaceRoom(roomId);
  if (!room) return false;
  // FK cascade removes the Workspace-owned runtime-session references. Pi's
  // native JSONL remains its own recoverable record and is never silently
  // removed by a UI operation.
  database.prepare("DELETE FROM rooms WHERE id = ?").run(roomId);
  return true;
}
