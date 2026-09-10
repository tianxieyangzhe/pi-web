import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const databasePath = process.env.AI_WORKSPACE_DB_PATH || path.join(process.cwd(), ".data", "workspace.sqlite");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

export const database = new Database(databasePath);
database.pragma("busy_timeout = 5000");
try { database.pragma("journal_mode = WAL"); } catch { /* another worker may initialize WAL */ }
database.pragma("foreign_keys = ON");

/**
 * The pre-Workspace-first schema used resource and session relation tables.
 * Migrate once when the old `working_directory` Workspace column proves the
 * legacy schema is present. The old tables are intentionally discarded after
 * preserving Workspace identities; we never run destructive DDL on later boots.
 */
const legacyWorkspaceColumns = database.prepare("PRAGMA table_info(workspaces)").all() as { name: string }[];
const hasLegacyWorkspaceSchema = legacyWorkspaceColumns.some((column) => column.name === "working_directory");
if (hasLegacyWorkspaceSchema) {
  database.exec(`
    PRAGMA foreign_keys = OFF;
    ALTER TABLE workspaces RENAME TO legacy_workspaces_v1;
    DROP TABLE IF EXISTS evidence_records;
    DROP TABLE IF EXISTS knowledge_documents;
    DROP TABLE IF EXISTS runtime_bindings;
    DROP TABLE IF EXISTS room_assets;
    DROP TABLE IF EXISTS room_sessions;
    DROP TABLE IF EXISTS room_agent_links;
    DROP TABLE IF EXISTS room_resource_links;
    DROP TABLE IF EXISTS interaction_rooms;
    DROP TABLE IF EXISTS agent_roles;
    DROP TABLE IF EXISTS workspace_runtimes;
    DROP TABLE IF EXISTS runtime_profiles;
    DROP TABLE IF EXISTS resource_relations;
    DROP TABLE IF EXISTS workspace_resources;
    DROP TABLE IF EXISTS session_messages;
    DROP TABLE IF EXISTS runtime_sessions;
    DROP TABLE IF EXISTS sessions;
    PRAGMA foreign_keys = ON;
  `);
}

database.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK (status IN ('active','archived')) DEFAULT 'active',
    default_runtime_id TEXT,
    active_room_id TEXT,
    inspector_json TEXT NOT NULL DEFAULT '{"visible":true,"kind":null,"resourceId":null,"openFileRefs":[],"expandedTreePaths":{}}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('code','knowledge','contract','external','environment')),
    location_kind TEXT NOT NULL CHECK (location_kind IN ('local_path','git_remote','api','none')),
    local_path TEXT,
    source_uri TEXT,
    access_mode TEXT NOT NULL CHECK (access_mode IN ('read','write','managed')) DEFAULT 'read',
    domain TEXT,
    configuration_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK (status IN ('active','disabled','archived')) DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    transport TEXT NOT NULL CHECK (transport IN ('stdio','sse','streamable_http','in_process')),
    connection_config_json TEXT NOT NULL DEFAULT '{}',
    secret_ref TEXT,
    capabilities_json TEXT NOT NULL DEFAULT '{}',
    allowed_project_ids_json TEXT NOT NULL DEFAULT '[]',
    access_policy TEXT NOT NULL CHECK (access_policy IN ('allow','approval','read_only')) DEFAULT 'approval',
    status TEXT NOT NULL CHECK (status IN ('ready','unavailable','disabled')) DEFAULT 'ready',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS runtimes (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('pi')),
    connection_kind TEXT NOT NULL CHECK (connection_kind IN ('local_sdk','local_process','remote_service')),
    configuration_json TEXT NOT NULL DEFAULT '{}',
    capabilities_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK (status IN ('ready','unavailable','disabled')) DEFAULT 'ready',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    role_kind TEXT NOT NULL CHECK (role_kind IN ('system','project','specialist','reviewer')),
    instruction TEXT NOT NULL DEFAULT '',
    default_runtime_id TEXT REFERENCES runtimes(id) ON DELETE SET NULL,
    allowed_project_ids_json TEXT NOT NULL DEFAULT '[]',
    allowed_mcp_ids_json TEXT NOT NULL DEFAULT '[]',
    execution_policy_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK (status IN ('active','disabled','archived')) DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    problem_statement TEXT,
    summary TEXT,
    project_ids_json TEXT NOT NULL DEFAULT '[]',
    mcp_ids_json TEXT NOT NULL DEFAULT '[]',
    agent_ids_json TEXT NOT NULL DEFAULT '[]',
    runtime_id TEXT NOT NULL REFERENCES runtimes(id) ON DELETE RESTRICT,
    active_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('active','paused','closed','archived')) DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    runtime_id TEXT NOT NULL REFERENCES runtimes(id) ON DELETE RESTRICT,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    cwd_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    native_session_ref TEXT,
    native_metadata_json TEXT NOT NULL DEFAULT '{}',
    purpose TEXT,
    state TEXT NOT NULL CHECK (state IN ('not_started','active','idle','ended','unavailable')) DEFAULT 'not_started',
    created_at TEXT NOT NULL,
    last_activity_at TEXT
  );
  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('evidence','fact','hypothesis','decision','deliverable','reference')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    provenance_json TEXT NOT NULL DEFAULT '{}',
    scope TEXT NOT NULL CHECK (scope IN ('room','workspace')) DEFAULT 'room',
    status TEXT NOT NULL CHECK (status IN ('draft','accepted','superseded','retracted')) DEFAULT 'draft',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS projects_workspace_idx ON projects(workspace_id, status, name);
  CREATE INDEX IF NOT EXISTS mcp_servers_workspace_idx ON mcp_servers(workspace_id, status, name);
  CREATE INDEX IF NOT EXISTS agents_workspace_idx ON agents(workspace_id, status, name);
  CREATE INDEX IF NOT EXISTS runtimes_workspace_idx ON runtimes(workspace_id, status, name);
  CREATE INDEX IF NOT EXISTS rooms_workspace_idx ON rooms(workspace_id, status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS sessions_room_idx ON sessions(room_id, state, last_activity_at DESC);
  CREATE INDEX IF NOT EXISTS assets_room_idx ON assets(room_id, created_at DESC);
`);

if (hasLegacyWorkspaceSchema) {
  database.exec(`
    INSERT INTO workspaces (id, name, description, status, created_at, updated_at)
    SELECT id, name, NULL, 'active', created_at, created_at FROM legacy_workspaces_v1;
    INSERT INTO projects (id, workspace_id, name, kind, location_kind, local_path, access_mode, configuration_json, status, created_at, updated_at)
    SELECT 'project-' || id, id, name, 'code', 'local_path', working_directory, 'write', '{}', 'active', created_at, created_at
    FROM legacy_workspaces_v1;
    DROP TABLE legacy_workspaces_v1;
  `);
}

export function getDatabasePath() { return databasePath; }
