export const targetSchema = `
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


  CREATE TABLE session_memories (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
    source_template_id TEXT REFERENCES session_memories(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    context_json TEXT NOT NULL CHECK(json_valid(context_json) AND json_type(context_json)='object'),
    draft_json TEXT CHECK(draft_json IS NULL OR (json_valid(draft_json) AND json_type(draft_json)='object')),
    last_reviewed_entry_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(id, project_id),
    CHECK(project_id IS NOT NULL OR (source_template_id IS NULL AND draft_json IS NULL AND last_reviewed_entry_id IS NULL))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    session_memory_id TEXT NOT NULL UNIQUE REFERENCES session_memories(id) ON DELETE RESTRICT,
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
    UNIQUE (id, session_memory_id, project_id),
    FOREIGN KEY (session_memory_id, project_id) REFERENCES session_memories(id, project_id) ON DELETE RESTRICT
  );


  CREATE INDEX session_memories_project_idx ON session_memories(project_id, updated_at);
  CREATE INDEX sessions_project_idx ON sessions(project_id, created_at);
  CREATE TRIGGER session_memories_owner_immutable BEFORE UPDATE OF project_id ON session_memories WHEN NEW.project_id IS NOT OLD.project_id BEGIN SELECT RAISE(ABORT,'memory ownership is immutable'); END;
  CREATE TRIGGER sessions_owner_immutable BEFORE UPDATE OF session_memory_id, project_id ON sessions WHEN NEW.session_memory_id IS NOT OLD.session_memory_id OR NEW.project_id IS NOT OLD.project_id BEGIN SELECT RAISE(ABORT,'session ownership is immutable'); END;
  CREATE TRIGGER memory_template_insert BEFORE INSERT ON session_memories WHEN NEW.source_template_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM session_memories WHERE id=NEW.source_template_id AND project_id IS NULL) BEGIN SELECT RAISE(ABORT,'source must be a template'); END;
  CREATE TRIGGER memory_template_update BEFORE UPDATE OF source_template_id ON session_memories WHEN NEW.source_template_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM session_memories WHERE id=NEW.source_template_id AND project_id IS NULL) BEGIN SELECT RAISE(ABORT,'source must be a template'); END;
`;
