import { database } from "@/lib/storage/database.server";
import type { McpServer, Project, Room, RuntimeSession, WorkspaceAgent, WorkspaceRuntime } from "@/lib/workspace/workspace-model";

type JsonRow = Record<string, unknown>;
const now = () => new Date().toISOString();
const json = (value: unknown) => JSON.stringify(value ?? {});

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function ids(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? [...new Set(parsed.filter((item): item is string => typeof item === "string" && item.length > 0))] : [];
  } catch {
    return [];
  }
}

function requireWorkspaceResource(table: "projects" | "mcp_servers" | "agents" | "runtimes", id: string, workspaceId: string) {
  const row = database.prepare(`SELECT id FROM ${table} WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as { id: string } | undefined;
  if (!row) throw new Error(`${table}:${id} 不属于当前 Workspace`);
}

function mapProject(row: JsonRow): Project {
  return { id: row.id as string, workspaceId: row.workspace_id as string, name: row.name as string, kind: row.kind as Project["kind"], locationKind: row.location_kind as Project["locationKind"], localPath: row.local_path as string | null, sourceUri: row.source_uri as string | null, accessMode: row.access_mode as Project["accessMode"], domain: row.domain as string | null, configuration: object(row.configuration_json), status: row.status as Project["status"] };
}
function mapMcp(row: JsonRow): McpServer {
  return { id: row.id as string, workspaceId: row.workspace_id as string, name: row.name as string, transport: row.transport as McpServer["transport"], connectionConfig: object(row.connection_config_json), secretRef: row.secret_ref as string | null, capabilities: object(row.capabilities_json), allowedProjectIds: ids(row.allowed_project_ids_json), accessPolicy: row.access_policy as McpServer["accessPolicy"], status: row.status as McpServer["status"] };
}
function mapAgent(row: JsonRow): WorkspaceAgent {
  return { id: row.id as string, workspaceId: row.workspace_id as string, name: row.name as string, roleKind: row.role_kind as WorkspaceAgent["roleKind"], instruction: row.instruction as string, defaultRuntimeId: row.default_runtime_id as string | null, allowedProjectIds: ids(row.allowed_project_ids_json), allowedMcpIds: ids(row.allowed_mcp_ids_json), executionPolicy: object(row.execution_policy_json), status: row.status as WorkspaceAgent["status"] };
}
function mapRuntime(row: JsonRow): WorkspaceRuntime {
  return { id: row.id as string, workspaceId: row.workspace_id as string, name: row.name as string, provider: "pi", connectionKind: row.connection_kind as WorkspaceRuntime["connectionKind"], configuration: object(row.configuration_json), capabilities: object(row.capabilities_json), status: row.status as WorkspaceRuntime["status"] };
}
function mapRoom(row: JsonRow): Room {
  return { id: row.id as string, workspaceId: row.workspace_id as string, title: row.title as string, problemStatement: row.problem_statement as string | null, summary: row.summary as string | null, projectIds: ids(row.project_ids_json), mcpIds: ids(row.mcp_ids_json), agentIds: ids(row.agent_ids_json), runtimeId: row.runtime_id as string, activeAgentId: row.active_agent_id as string, status: row.status as Room["status"], createdAt: row.created_at as string, updatedAt: row.updated_at as string };
}
function mapRuntimeSession(row: JsonRow): RuntimeSession {
  return { id: row.id as string, workspaceId: row.workspace_id as string, roomId: row.room_id as string, runtimeId: row.runtime_id as string, agentId: row.agent_id as string, cwdProjectId: row.cwd_project_id as string | null, nativeSessionRef: row.native_session_ref as string | null, nativeMetadata: object(row.native_metadata_json), purpose: row.purpose as string | null, state: row.state as RuntimeSession["state"], createdAt: row.created_at as string, lastActivityAt: row.last_activity_at as string | null };
}

/** Creates only the default Pi Runtime and Agent. Projects and MCPs are always explicit user resources. */
export function ensureWorkspaceBaseline(input: { workspaceId: string }) {
  const timestamp = now();
  const runtimeId = `runtime-pi-${input.workspaceId}`;
  const agentId = `agent-pi-${input.workspaceId}`;
  database.transaction(() => {
    database.prepare("INSERT OR IGNORE INTO runtimes (id, workspace_id, name, provider, connection_kind, configuration_json, capabilities_json, status, created_at, updated_at) VALUES (?, ?, 'Pi', 'pi', 'local_sdk', '{}', '{}', 'ready', ?, ?)")
      .run(runtimeId, input.workspaceId, timestamp, timestamp);
    database.prepare("INSERT OR IGNORE INTO agents (id, workspace_id, name, role_kind, instruction, default_runtime_id, allowed_project_ids_json, allowed_mcp_ids_json, execution_policy_json, status, created_at, updated_at) VALUES (?, ?, 'Pi Agent', 'system', '', ?, '[]', '[]', '{}', 'active', ?, ?)")
      .run(agentId, input.workspaceId, runtimeId, timestamp, timestamp);
    database.prepare("UPDATE workspaces SET default_runtime_id = COALESCE(default_runtime_id, ?), updated_at = COALESCE(updated_at, ?) WHERE id = ?")
      .run(runtimeId, timestamp, input.workspaceId);
  })();
  return { runtimeId, agentId };
}

export function listProjects(workspaceId: string) { return (database.prepare("SELECT * FROM projects WHERE workspace_id = ? ORDER BY name").all(workspaceId) as JsonRow[]).map(mapProject); }
export function getProject(projectId: string) { const row = database.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as JsonRow | undefined; return row ? mapProject(row) : undefined; }
export function listMcpServers(workspaceId: string) { return (database.prepare("SELECT * FROM mcp_servers WHERE workspace_id = ? ORDER BY name").all(workspaceId) as JsonRow[]).map(mapMcp); }
export function listAgents(workspaceId: string) { return (database.prepare("SELECT * FROM agents WHERE workspace_id = ? ORDER BY name").all(workspaceId) as JsonRow[]).map(mapAgent); }
export function listRuntimes(workspaceId: string) { return (database.prepare("SELECT * FROM runtimes WHERE workspace_id = ? ORDER BY name").all(workspaceId) as JsonRow[]).map(mapRuntime); }
export type EditableResourceKind = "project" | "mcp" | "agent";
const resourceTable: Record<EditableResourceKind, "projects" | "mcp_servers" | "agents"> = { project: "projects", mcp: "mcp_servers", agent: "agents" };

export function getWorkspaceResource(workspaceId: string, kind: EditableResourceKind, id: string) {
  const table = resourceTable[kind];
  const row = database.prepare(`SELECT * FROM ${table} WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as JsonRow | undefined;
  if (!row) return undefined;
  return kind === "project" ? mapProject(row) : kind === "mcp" ? mapMcp(row) : mapAgent(row);
}

export function createWorkspaceResource(workspaceId: string, kind: EditableResourceKind, input: Record<string, unknown>) {
  const timestamp = now(); const id = `${kind}-${crypto.randomUUID()}`;
  if (kind === "project") {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const localPath = typeof input.localPath === "string" ? input.localPath.trim() : "";
    if (!name || !localPath) throw new Error("项目名称和本地路径不能为空");
    database.prepare("INSERT INTO projects (id, workspace_id, name, kind, location_kind, local_path, source_uri, access_mode, domain, configuration_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'local_path', ?, NULL, ?, NULL, '{}', 'active', ?, ?)").run(id, workspaceId, name, input.kind === "knowledge" ? "knowledge" : "code", localPath, input.accessMode === "read" ? "read" : "write", timestamp, timestamp);
  } else if (kind === "mcp") {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) throw new Error("MCP 名称不能为空");
    database.prepare("INSERT INTO mcp_servers (id, workspace_id, name, transport, connection_config_json, capabilities_json, allowed_project_ids_json, access_policy, status, created_at, updated_at) VALUES (?, ?, ?, ?, '{}', '{}', '[]', 'approval', 'ready', ?, ?)").run(id, workspaceId, name, input.transport === "sse" || input.transport === "streamable_http" || input.transport === "in_process" ? input.transport : "stdio", timestamp, timestamp);
  } else {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) throw new Error("Agent 名称不能为空");
    const runtime = database.prepare("SELECT id FROM runtimes WHERE workspace_id = ? AND status = 'ready' ORDER BY created_at LIMIT 1").get(workspaceId) as { id: string } | undefined;
    if (!runtime) throw new Error("当前 Workspace 没有可用 Runtime");
    database.prepare("INSERT INTO agents (id, workspace_id, name, role_kind, instruction, default_runtime_id, allowed_project_ids_json, allowed_mcp_ids_json, execution_policy_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', '{}', 'active', ?, ?)").run(id, workspaceId, name, input.roleKind === "project" || input.roleKind === "specialist" || input.roleKind === "reviewer" ? input.roleKind : "system", typeof input.instruction === "string" ? input.instruction.trim() : "", runtime.id, timestamp, timestamp);
  }
  return getWorkspaceResource(workspaceId, kind, id)!;
}

export function updateWorkspaceResource(workspaceId: string, kind: EditableResourceKind, id: string, input: Record<string, unknown>) {
  if (!getWorkspaceResource(workspaceId, kind, id)) throw new Error("资源不存在");
  const timestamp = now();
  if (kind === "project") {
    const name = typeof input.name === "string" ? input.name.trim() : ""; const localPath = typeof input.localPath === "string" ? input.localPath.trim() : "";
    if (!name || !localPath) throw new Error("项目名称和本地路径不能为空");
    database.prepare("UPDATE projects SET name = ?, kind = ?, local_path = ?, access_mode = ?, updated_at = ? WHERE id = ? AND workspace_id = ?").run(name, input.kind === "knowledge" ? "knowledge" : "code", localPath, input.accessMode === "read" ? "read" : "write", timestamp, id, workspaceId);
  } else if (kind === "mcp") {
    const name = typeof input.name === "string" ? input.name.trim() : ""; if (!name) throw new Error("MCP 名称不能为空");
    database.prepare("UPDATE mcp_servers SET name = ?, transport = ?, updated_at = ? WHERE id = ? AND workspace_id = ?").run(name, input.transport === "sse" || input.transport === "streamable_http" || input.transport === "in_process" ? input.transport : "stdio", timestamp, id, workspaceId);
  } else {
    const name = typeof input.name === "string" ? input.name.trim() : ""; if (!name) throw new Error("Agent 名称不能为空");
    database.prepare("UPDATE agents SET name = ?, role_kind = ?, instruction = ?, updated_at = ? WHERE id = ? AND workspace_id = ?").run(name, input.roleKind === "project" || input.roleKind === "specialist" || input.roleKind === "reviewer" ? input.roleKind : "system", typeof input.instruction === "string" ? input.instruction.trim() : "", timestamp, id, workspaceId);
  }
  return getWorkspaceResource(workspaceId, kind, id)!;
}

export function deleteWorkspaceResource(workspaceId: string, kind: EditableResourceKind, id: string) {
  if (!getWorkspaceResource(workspaceId, kind, id)) return false;
  const column = kind === "project" ? "project_ids_json" : kind === "mcp" ? "mcp_ids_json" : "agent_ids_json";
  const inRoom = database.prepare(`SELECT id FROM rooms WHERE workspace_id = ? AND instr(${column}, ?) > 0 LIMIT 1`).get(workspaceId, id);
  const inSession = kind === "project" ? database.prepare("SELECT id FROM sessions WHERE cwd_project_id = ? LIMIT 1").get(id) : kind === "agent" ? database.prepare("SELECT id FROM sessions WHERE agent_id = ? LIMIT 1").get(id) : undefined;
  if (inRoom || inSession) throw new Error("资源正在被 Room 或 Session 使用，不能删除");
  database.prepare(`DELETE FROM ${resourceTable[kind]} WHERE id = ? AND workspace_id = ?`).run(id, workspaceId);
  return true;
}
export function listWorkspaceRooms(workspaceId: string) { return (database.prepare("SELECT * FROM rooms WHERE workspace_id = ? ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC").all(workspaceId) as JsonRow[]).map(mapRoom); }
export function getWorkspaceRoom(roomId: string) { const row = database.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId) as JsonRow | undefined; return row ? mapRoom(row) : undefined; }

export function createWorkspaceRoom(input: { workspaceId: string; title?: string; problemStatement?: string; projectIds?: string[]; mcpIds?: string[]; agentIds?: string[]; runtimeId?: string; activeAgentId?: string }) {
  const workspace = database.prepare("SELECT id FROM workspaces WHERE id = ?").get(input.workspaceId) as { id: string } | undefined;
  if (!workspace) throw new Error("Workspace 不存在");
  const baseline = ensureWorkspaceBaseline({ workspaceId: workspace.id });
  const projectIds = [...new Set(input.projectIds ?? [])];
  const mcpIds = [...new Set(input.mcpIds ?? [])];
  const agentIds = [...new Set(input.agentIds?.length ? input.agentIds : [baseline.agentId])];
  const runtimeId = input.runtimeId ?? baseline.runtimeId;
  const activeAgentId = input.activeAgentId ?? agentIds[0];
  if (!activeAgentId || !agentIds.includes(activeAgentId)) throw new Error("activeAgentId 必须属于 agentIds");

  for (const id of projectIds) requireWorkspaceResource("projects", id, input.workspaceId);
  for (const id of mcpIds) requireWorkspaceResource("mcp_servers", id, input.workspaceId);
  for (const id of agentIds) requireWorkspaceResource("agents", id, input.workspaceId);
  requireWorkspaceResource("runtimes", runtimeId, input.workspaceId);

  const agent = database.prepare("SELECT allowed_project_ids_json, allowed_mcp_ids_json FROM agents WHERE id = ?").get(activeAgentId) as JsonRow;
  const allowedProjects = ids(agent.allowed_project_ids_json);
  const allowedMcps = ids(agent.allowed_mcp_ids_json);
  if (allowedProjects.length && projectIds.some((id) => !allowedProjects.includes(id))) throw new Error("当前 Agent 不允许访问某个选中的项目");
  if (allowedMcps.length && mcpIds.some((id) => !allowedMcps.includes(id))) throw new Error("当前 Agent 不允许使用某个选中的 MCP");

  const timestamp = now();
  const id = `room-${crypto.randomUUID()}`;
  database.prepare("INSERT INTO rooms (id, workspace_id, title, problem_statement, summary, project_ids_json, mcp_ids_json, agent_ids_json, runtime_id, active_agent_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'active', ?, ?)")
    .run(id, input.workspaceId, input.title?.trim() || "新建 Room", input.problemStatement?.trim() || null, JSON.stringify(projectIds), JSON.stringify(mcpIds), JSON.stringify(agentIds), runtimeId, activeAgentId, timestamp, timestamp);
  database.prepare("UPDATE workspaces SET active_room_id = ?, updated_at = ? WHERE id = ?").run(id, timestamp, input.workspaceId);
  return getWorkspaceRoom(id)!;
}

export function createRuntimeSession(input: { roomId: string; agentId?: string; cwdProjectId?: string | null; purpose?: string }) {
  const room = getWorkspaceRoom(input.roomId);
  if (!room) throw new Error("Room 不存在");
  const agentId = input.agentId ?? room.activeAgentId;
  if (!room.agentIds.includes(agentId)) throw new Error("Agent 不属于当前 Room");
  const cwdProjectId = input.cwdProjectId === undefined ? room.projectIds[0] ?? null : input.cwdProjectId;
  if (cwdProjectId && !room.projectIds.includes(cwdProjectId)) throw new Error("工作目录 Project 不属于当前 Room");
  requireWorkspaceResource("agents", agentId, room.workspaceId);
  requireWorkspaceResource("runtimes", room.runtimeId, room.workspaceId);
  if (cwdProjectId) requireWorkspaceResource("projects", cwdProjectId, room.workspaceId);

  const id = `runtime-session-${crypto.randomUUID()}`;
  const timestamp = now();
  database.prepare("INSERT INTO sessions (id, workspace_id, room_id, runtime_id, agent_id, cwd_project_id, native_session_ref, native_metadata_json, purpose, state, created_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, NULL, '{}', ?, 'not_started', ?, NULL)")
    .run(id, room.workspaceId, room.id, room.runtimeId, agentId, cwdProjectId, input.purpose?.trim() || null, timestamp);
  return mapRuntimeSession(database.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as JsonRow);
}

export function listRuntimeSessions(roomId: string) { return (database.prepare("SELECT * FROM sessions WHERE room_id = ? ORDER BY created_at").all(roomId) as JsonRow[]).map(mapRuntimeSession); }

export function updateRuntimeSessionNativeRef(id: string, patch: { nativeSessionRef?: string; nativeMetadata?: Record<string, unknown>; state?: RuntimeSession["state"] }) {
  database.prepare("UPDATE sessions SET native_session_ref = COALESCE(?, native_session_ref), native_metadata_json = COALESCE(?, native_metadata_json), state = COALESCE(?, state), last_activity_at = ? WHERE id = ?")
    .run(patch.nativeSessionRef ?? null, patch.nativeMetadata ? json(patch.nativeMetadata) : null, patch.state ?? null, now(), id);
  const row = database.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as JsonRow | undefined;
  return row ? mapRuntimeSession(row) : undefined;
}
