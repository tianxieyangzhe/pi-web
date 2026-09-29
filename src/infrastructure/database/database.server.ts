import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const databasePath = process.env.AI_WORKSPACE_DB_PATH ?? path.join(process.cwd(), ".data", "ai-workspace-v5.sqlite");

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

export const database = new Database(databasePath);
database.pragma("busy_timeout = 5000");
database.pragma("foreign_keys = ON");
try {
  database.pragma("journal_mode = WAL");
} catch {
  // Another local process may already be initializing WAL.
}

database.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('code','knowledge','general')),
    root_path TEXT NOT NULL UNIQUE,
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
    kind TEXT NOT NULL CHECK (kind = 'cross_project'),
    title TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active','paused','closed','archived')),
    context_revision INTEGER NOT NULL DEFAULT 1 CHECK (context_revision >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS room_projects (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    position INTEGER NOT NULL CHECK (position >= 0),
    created_at TEXT NOT NULL,
    UNIQUE (room_id, project_id),
    UNIQUE (room_id, position)
  );

  CREATE TABLE IF NOT EXISTS room_runs (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    request_text TEXT NOT NULL,
    project_hint_id TEXT,
    route TEXT CHECK (route IS NULL OR route IN ('direct','single_project','multi_project')),
    state TEXT NOT NULL CHECK (state IN ('received','routing','review_pending','dispatching','running','synthesizing','completed','blocked','failed','cancelled')),
    router_summary TEXT,
    final_response TEXT,
    error_code TEXT,
    context_revision INTEGER NOT NULL CHECK (context_revision >= 1),
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    UNIQUE (id, room_id),
    FOREIGN KEY (room_id, project_hint_id) REFERENCES room_projects(room_id, project_id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    purpose TEXT NOT NULL,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    agent_snapshot_json TEXT CHECK (agent_snapshot_json IS NULL OR (json_valid(agent_snapshot_json) AND json_type(agent_snapshot_json) = 'object')),
    mcp_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(mcp_ids_json) AND json_type(mcp_ids_json) = 'array'),
    mcp_snapshots_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(mcp_snapshots_json) AND json_type(mcp_snapshots_json) = 'array'),
    state TEXT NOT NULL CHECK (state IN ('not_started','starting','idle','running','interrupting','ended','unavailable')),
    native_ref_json TEXT CHECK (native_ref_json IS NULL OR (json_valid(native_ref_json) AND json_type(native_ref_json) = 'object')),
    native_metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(native_metadata_json) AND json_type(native_metadata_json) = 'object'),
    created_at TEXT NOT NULL,
    last_activity_at TEXT,
    ended_at TEXT,
    CHECK ((agent_id IS NULL AND agent_snapshot_json IS NULL) OR (agent_id IS NOT NULL AND agent_snapshot_json IS NOT NULL)),
    UNIQUE (id, room_id, project_id)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    retry_of_task_id TEXT REFERENCES tasks(id) ON DELETE RESTRICT,
    project_id TEXT NOT NULL,
    session_id TEXT,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    mcp_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(mcp_ids_json) AND json_type(mcp_ids_json) = 'array'),
    instruction TEXT NOT NULL,
    acceptance_json TEXT NOT NULL CHECK (json_valid(acceptance_json) AND json_type(acceptance_json) = 'array'),
    operation TEXT NOT NULL CHECK (operation IN ('read','project_write','external_write')),
    risk TEXT NOT NULL CHECK (risk IN ('low','medium','high')),
    state TEXT NOT NULL CHECK (state IN ('proposed','review_pending','approved','queued','running','completed','blocked','failed','cancelled')),
    result_json TEXT CHECK (result_json IS NULL OR (json_valid(result_json) AND json_type(result_json) = 'object')),
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (run_id, room_id) REFERENCES room_runs(id, room_id) ON DELETE CASCADE,
    FOREIGN KEY (room_id, project_id) REFERENCES room_projects(room_id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (session_id, room_id, project_id) REFERENCES sessions(id, room_id, project_id) ON DELETE RESTRICT,
    CHECK (
      (state IN ('completed','blocked','failed') AND result_json IS NOT NULL)
      OR (state NOT IN ('completed','blocked','failed') AND result_json IS NULL)
    )
  );

  CREATE TABLE IF NOT EXISTS room_contents (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('overview','goal','rule','memory','direction','decision','output')),
    output_kind TEXT CHECK (output_kind IS NULL OR output_kind IN ('note','plan','delivery','summary')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('candidate','active','adopted','dismissed','draft','published','superseded','retracted')),
    source_run_id TEXT REFERENCES room_runs(id) ON DELETE SET NULL,
    source_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK ((kind = 'output' AND output_kind IS NOT NULL) OR (kind <> 'output' AND output_kind IS NULL)),
    CHECK (
      (kind = 'overview' AND status IN ('active','superseded'))
      OR (kind IN ('goal','rule','memory') AND status IN ('candidate','active','dismissed','superseded','retracted'))
      OR (kind IN ('direction','decision') AND status IN ('candidate','adopted','dismissed','superseded','retracted'))
      OR (kind = 'output' AND status IN ('draft','published','superseded','retracted'))
    ),
    CHECK (
      (CASE WHEN source_run_id IS NULL THEN 0 ELSE 1 END)
      + (CASE WHEN source_task_id IS NULL THEN 0 ELSE 1 END)
      + (CASE WHEN source_session_id IS NULL THEN 0 ELSE 1 END) <= 1
    )
  );

  CREATE UNIQUE INDEX IF NOT EXISTS room_contents_one_active_overview
    ON room_contents(room_id) WHERE kind = 'overview' AND status = 'active';
  CREATE UNIQUE INDEX IF NOT EXISTS room_contents_one_active_goal
    ON room_contents(room_id) WHERE kind = 'goal' AND status = 'active';
  CREATE INDEX IF NOT EXISTS rooms_updated_idx ON rooms(updated_at DESC, id);
  CREATE INDEX IF NOT EXISTS room_projects_project_idx ON room_projects(project_id, room_id);
  CREATE INDEX IF NOT EXISTS room_runs_room_created_idx ON room_runs(room_id, created_at DESC, id);
  CREATE INDEX IF NOT EXISTS tasks_run_state_idx ON tasks(run_id, state, created_at, id);
  CREATE INDEX IF NOT EXISTS sessions_room_project_idx ON sessions(room_id, project_id, state, created_at, id);
  CREATE INDEX IF NOT EXISTS sessions_direct_project_idx ON sessions(project_id, state, created_at, id) WHERE room_id IS NULL;

  CREATE TRIGGER IF NOT EXISTS room_projects_immutable
    BEFORE UPDATE ON room_projects
    BEGIN
      SELECT RAISE(ABORT, 'room project scope is immutable');
    END;

  CREATE TRIGGER IF NOT EXISTS room_projects_delete_with_room_only
    BEFORE DELETE ON room_projects
    WHEN EXISTS (SELECT 1 FROM rooms WHERE id = OLD.room_id)
    BEGIN
      SELECT RAISE(ABORT, 'room project scope can only be deleted with its room');
    END;

  CREATE TRIGGER IF NOT EXISTS sessions_project_immutable
    BEFORE UPDATE OF project_id ON sessions
    WHEN NEW.project_id <> OLD.project_id
    BEGIN
      SELECT RAISE(ABORT, 'session project is immutable');
    END;

  CREATE TRIGGER IF NOT EXISTS sessions_room_immutable
    BEFORE UPDATE OF room_id ON sessions
    WHEN NEW.room_id IS NOT OLD.room_id
    BEGIN
      SELECT RAISE(ABORT, 'session room ownership is immutable');
    END;

  CREATE TRIGGER IF NOT EXISTS sessions_room_scope_insert
    BEFORE INSERT ON sessions
    WHEN NEW.room_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM room_projects WHERE room_id = NEW.room_id AND project_id = NEW.project_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'room session project must belong to room scope');
    END;

  CREATE TRIGGER IF NOT EXISTS tasks_retry_same_scope_insert
    BEFORE INSERT ON tasks
    WHEN NEW.retry_of_task_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM tasks WHERE id = NEW.retry_of_task_id AND run_id = NEW.run_id
          AND room_id = NEW.room_id AND project_id = NEW.project_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'retry task must share room run and project');
    END;

  CREATE TRIGGER IF NOT EXISTS tasks_retry_same_scope_update
    BEFORE UPDATE OF retry_of_task_id, run_id, room_id, project_id ON tasks
    WHEN NEW.retry_of_task_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM tasks WHERE id = NEW.retry_of_task_id AND run_id = NEW.run_id
          AND room_id = NEW.room_id AND project_id = NEW.project_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'retry task must share room run and project');
    END;

  CREATE TRIGGER IF NOT EXISTS room_contents_source_insert
    BEFORE INSERT ON room_contents
    WHEN (NEW.source_run_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM room_runs WHERE id = NEW.source_run_id AND room_id = NEW.room_id
    )) OR (NEW.source_task_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM tasks WHERE id = NEW.source_task_id AND room_id = NEW.room_id
    )) OR (NEW.source_session_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM sessions WHERE id = NEW.source_session_id AND room_id = NEW.room_id
    ))
    BEGIN
      SELECT RAISE(ABORT, 'room content source must belong to the same room');
    END;

  CREATE TRIGGER IF NOT EXISTS room_contents_source_update
    BEFORE UPDATE OF source_run_id, source_task_id, source_session_id, room_id ON room_contents
    WHEN (NEW.source_run_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM room_runs WHERE id = NEW.source_run_id AND room_id = NEW.room_id
    )) OR (NEW.source_task_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM tasks WHERE id = NEW.source_task_id AND room_id = NEW.room_id
    )) OR (NEW.source_session_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM sessions WHERE id = NEW.source_session_id AND room_id = NEW.room_id
    ))
    BEGIN
      SELECT RAISE(ABORT, 'room content source must belong to the same room');
    END;
`);

export function getDatabasePath(): string {
  return databasePath;
}
