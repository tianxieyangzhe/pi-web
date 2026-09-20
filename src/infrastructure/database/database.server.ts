import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const databasePath =
  process.env.AI_WORKSPACE_DB_PATH ??
  path.join(process.cwd(), ".data", "ai-workspace-v2.sqlite");

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

export const database = new Database(databasePath);
database.pragma("busy_timeout = 5000");
database.pragma("foreign_keys = ON");
try {
  database.pragma("journal_mode = WAL");
} catch {
  // Another development worker may already be initializing WAL.
}

database.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK (status IN ('active','archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('code','knowledge','general')),
    root_path TEXT NOT NULL UNIQUE,
    access_mode TEXT NOT NULL CHECK (access_mode IN ('read','write')),
    status TEXT NOT NULL CHECK (status IN ('active','disabled','archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mcps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    config_json TEXT NOT NULL CHECK (json_valid(config_json) AND json_type(config_json) = 'object'),
    access_policy TEXT NOT NULL CHECK (access_policy IN ('read_only','approval','allow')),
    status TEXT NOT NULL CHECK (status IN ('active','disabled','archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    extension_json TEXT NOT NULL CHECK (json_valid(extension_json) AND json_type(extension_json) = 'object'),
    policy_json TEXT NOT NULL CHECK (json_valid(policy_json) AND json_type(policy_json) = 'object'),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    status TEXT NOT NULL CHECK (status IN ('active','disabled','archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active','paused','closed','archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (id, workspace_id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    room_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('primary','worker')),
    purpose TEXT,
    parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    agent_snapshot_json TEXT CHECK (agent_snapshot_json IS NULL OR (json_valid(agent_snapshot_json) AND json_type(agent_snapshot_json) = 'object')),
    mcp_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(mcp_ids_json) AND json_type(mcp_ids_json) = 'array'),
    mcp_snapshots_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(mcp_snapshots_json) AND json_type(mcp_snapshots_json) = 'array'),
    working_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    reference_project_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reference_project_ids_json) AND json_type(reference_project_ids_json) = 'array'),
    configuration_revision INTEGER NOT NULL DEFAULT 1 CHECK (configuration_revision >= 1),
    state TEXT NOT NULL CHECK (state IN ('not_started','starting','idle','running','interrupting','ended','unavailable')),
    native_ref_json TEXT CHECK (native_ref_json IS NULL OR (json_valid(native_ref_json) AND json_type(native_ref_json) = 'object')),
    native_metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(native_metadata_json) AND json_type(native_metadata_json) = 'object'),
    created_at TEXT NOT NULL,
    last_activity_at TEXT,
    ended_at TEXT,
    CHECK ((role = 'primary' AND parent_session_id IS NULL) OR (role = 'worker' AND length(trim(purpose)) > 0)),
    CHECK ((agent_id IS NULL AND agent_snapshot_json IS NULL) OR (agent_id IS NOT NULL AND agent_snapshot_json IS NOT NULL)),
    UNIQUE (id, room_id),
    FOREIGN KEY (room_id, workspace_id) REFERENCES rooms(id, workspace_id) ON DELETE CASCADE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_primary_per_room
    ON sessions(room_id) WHERE role = 'primary';
  CREATE INDEX IF NOT EXISTS sessions_workspace_room_idx
    ON sessions(workspace_id, room_id, created_at);

  CREATE TABLE IF NOT EXISTS room_contents (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('overview','goal','direction','output')),
    output_kind TEXT CHECK (output_kind IS NULL OR output_kind IN ('note','decision','plan','delivery','summary')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('candidate','active','adopted','dismissed','draft','published','superseded','retracted')),
    source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (kind = 'output' AND output_kind IS NOT NULL)
      OR (kind <> 'output' AND output_kind IS NULL)
    ),
    CHECK (
      (kind = 'overview' AND status IN ('active','superseded'))
      OR (kind = 'goal' AND status IN ('active','superseded','retracted'))
      OR (kind = 'direction' AND status IN ('candidate','adopted','dismissed'))
      OR (kind = 'output' AND status IN ('draft','published','superseded','retracted'))
    )
  );

  CREATE UNIQUE INDEX IF NOT EXISTS room_contents_one_active_overview
    ON room_contents(room_id) WHERE kind = 'overview' AND status = 'active';
  CREATE UNIQUE INDEX IF NOT EXISTS room_contents_one_active_goal
    ON room_contents(room_id) WHERE kind = 'goal' AND status = 'active';
  CREATE INDEX IF NOT EXISTS room_contents_room_kind_position
    ON room_contents(room_id, kind, position, updated_at);

  CREATE TRIGGER IF NOT EXISTS room_contents_source_insert
    BEFORE INSERT ON room_contents
    WHEN NEW.source_session_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM sessions
        WHERE id = NEW.source_session_id AND room_id = NEW.room_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'source session must belong to the same room');
    END;

  CREATE TRIGGER IF NOT EXISTS room_contents_source_update
    BEFORE UPDATE OF source_session_id, room_id ON room_contents
    WHEN NEW.source_session_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM sessions
        WHERE id = NEW.source_session_id AND room_id = NEW.room_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'source session must belong to the same room');
    END;
`);

export function getDatabasePath(): string {
  return databasePath;
}
