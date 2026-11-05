CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  default_project_id TEXT NOT NULL,
  create_request_key TEXT NOT NULL UNIQUE,
  create_request_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(id,default_project_id) REFERENCES workspace_projects(workspace_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE workspace_projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  root_path TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal>=0),
  UNIQUE(workspace_id,id)
);
CREATE INDEX workspace_projects_owner_idx ON workspace_projects(workspace_id,ordinal);
CREATE TABLE workspace_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  default_project_id TEXT NOT NULL,
  session_memory_id TEXT NOT NULL UNIQUE REFERENCES session_memories(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL,
  native_ref_json TEXT CHECK(native_ref_json IS NULL OR (json_valid(native_ref_json) AND json_type(native_ref_json)='object')),
  create_request_key TEXT NOT NULL,
  create_request_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ended_at TEXT,
  UNIQUE(workspace_id,create_request_key),
  FOREIGN KEY(workspace_id,default_project_id) REFERENCES workspace_projects(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(session_memory_id,workspace_id) REFERENCES session_memories(id,workspace_id) ON DELETE RESTRICT
);
CREATE INDEX workspace_sessions_owner_idx ON workspace_sessions(workspace_id,created_at,id);
CREATE TRIGGER workspace_project_owner_fixed BEFORE UPDATE OF id,workspace_id ON workspace_projects WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id BEGIN SELECT RAISE(ABORT,'workspace project identity is immutable'); END;
CREATE TRIGGER workspace_project_cwd_fixed BEFORE UPDATE OF root_path ON workspace_projects WHEN NEW.root_path IS NOT OLD.root_path AND EXISTS(SELECT 1 FROM workspace_sessions WHERE default_project_id=OLD.id) BEGIN SELECT RAISE(ABORT,'session default directory is immutable'); END;
CREATE TRIGGER workspace_session_owner_fixed BEFORE UPDATE ON workspace_sessions WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.default_project_id IS NOT OLD.default_project_id OR NEW.session_memory_id IS NOT OLD.session_memory_id OR NEW.create_request_key IS NOT OLD.create_request_key OR NEW.create_request_sha256 IS NOT OLD.create_request_sha256 OR (OLD.native_ref_json IS NOT NULL AND NEW.native_ref_json IS NOT OLD.native_ref_json) OR (OLD.ended_at IS NOT NULL AND NEW.ended_at IS NOT OLD.ended_at) BEGIN SELECT RAISE(ABORT,'workspace session identity is immutable'); END;
