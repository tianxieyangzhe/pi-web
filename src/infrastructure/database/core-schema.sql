
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('code','knowledge','general')),
    root_path TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('active','disabled','archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE mcps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    config_json TEXT NOT NULL CHECK (json_valid(config_json) AND json_type(config_json) = 'object'),
    access_policy TEXT NOT NULL CHECK (access_policy IN ('read_only','approval','allow')),
    status TEXT NOT NULL CHECK (status IN ('active','disabled','archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    kind TEXT CHECK(kind IS NULL OR kind IN ('coordinator','project')),
    bot_id TEXT REFERENCES bots(id) ON DELETE RESTRICT,
    project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
    source_template_id TEXT REFERENCES agents(id) ON DELETE RESTRICT,
    definition_json TEXT CHECK(definition_json IS NULL OR (json_valid(definition_json) AND json_type(definition_json)='object')),
    extension_json TEXT NOT NULL CHECK (json_valid(extension_json) AND json_type(extension_json) = 'object'),
    policy_json TEXT NOT NULL CHECK (json_valid(policy_json) AND json_type(policy_json) = 'object'),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    content_sha256 TEXT CHECK(content_sha256 IS NULL OR (length(content_sha256)=64 AND content_sha256 NOT GLOB '*[^0-9a-f]*')),
    status TEXT NOT NULL CHECK (status IN ('active','disabled','archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );


  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    purpose TEXT NOT NULL DEFAULT '' CHECK(length(purpose)<=500),
    bot_conversation_id TEXT REFERENCES bot_conversations(id) ON DELETE RESTRICT,
    participant_name TEXT,
    assignment TEXT,
    collaboration_state TEXT CHECK(collaboration_state IS NULL OR collaboration_state IN ('active','disabled')),
    bot_joined_at TEXT,
    updated_at TEXT NOT NULL,
    agent_id TEXT REFERENCES agents(id) ON DELETE RESTRICT,
    agent_snapshot_json TEXT CHECK(agent_snapshot_json IS NULL OR (json_valid(agent_snapshot_json) AND json_type(agent_snapshot_json)='object')),
    mcp_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(mcp_ids_json) AND json_type(mcp_ids_json)='array'),
    mcp_snapshots_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(mcp_snapshots_json) AND json_type(mcp_snapshots_json)='array'),
    native_ref_json TEXT CHECK(native_ref_json IS NULL OR (json_valid(native_ref_json) AND json_type(native_ref_json)='object' AND json_extract(native_ref_json,'$.kind') IS 'pi' AND json_type(native_ref_json,'$.sessionFile') IS 'text' AND json_type(native_ref_json,'$.sessionId') IS 'text' AND json_type(native_ref_json,'$.cwd') IS 'text' AND coalesce(length(json_extract(native_ref_json,'$.sessionFile')),0)>0 AND coalesce(length(json_extract(native_ref_json,'$.sessionId')),0)>0 AND coalesce(length(json_extract(native_ref_json,'$.cwd')),0)>0)),
    native_metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(native_metadata_json) AND json_type(native_metadata_json)='object'),
    created_at TEXT NOT NULL,
    last_activity_at TEXT,
    ended_at TEXT,
    create_request_key_hash TEXT,
    create_request_sha256 TEXT,
    CHECK((agent_id IS NULL AND agent_snapshot_json IS NULL) OR (agent_id IS NOT NULL AND agent_snapshot_json IS NOT NULL AND json_extract(agent_snapshot_json,'$.agentId') IS agent_id)),
    CHECK((create_request_key_hash IS NULL AND create_request_sha256 IS NULL) OR (create_request_key_hash IS NOT NULL AND create_request_sha256 IS NOT NULL AND length(create_request_key_hash)=64 AND create_request_key_hash NOT GLOB '*[^0-9a-f]*' AND length(create_request_sha256)=64 AND create_request_sha256 NOT GLOB '*[^0-9a-f]*')),
    UNIQUE(id,bot_conversation_id),
    UNIQUE(project_id,create_request_key_hash)
  );
  CREATE INDEX sessions_project_idx ON sessions(project_id,created_at,id);
  CREATE UNIQUE INDEX sessions_native_id_unique ON sessions(json_extract(native_ref_json,'$.sessionId')) WHERE native_ref_json IS NOT NULL;
  CREATE UNIQUE INDEX sessions_native_file_unique ON sessions(json_extract(native_ref_json,'$.sessionFile')) WHERE native_ref_json IS NOT NULL;
  CREATE TRIGGER sessions_owner_immutable BEFORE UPDATE ON sessions WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.created_at IS NOT OLD.created_at OR NEW.agent_id IS NOT OLD.agent_id OR NEW.create_request_key_hash IS NOT OLD.create_request_key_hash OR NEW.create_request_sha256 IS NOT OLD.create_request_sha256 OR (OLD.native_ref_json IS NOT NULL AND NEW.native_ref_json IS NOT OLD.native_ref_json) OR (OLD.ended_at IS NOT NULL AND NEW.ended_at IS NOT OLD.ended_at) BEGIN SELECT RAISE(ABORT,'session identity is immutable'); END;
  CREATE TRIGGER sessions_native_cwd_insert BEFORE INSERT ON sessions WHEN NEW.native_ref_json IS NOT NULL AND json_extract(NEW.native_ref_json,'$.cwd') IS NOT (SELECT root_path FROM projects WHERE id=NEW.project_id) BEGIN SELECT RAISE(ABORT,'native cwd differs from project'); END;
  CREATE TRIGGER sessions_native_cwd_update BEFORE UPDATE OF native_ref_json ON sessions WHEN NEW.native_ref_json IS NOT NULL AND json_extract(NEW.native_ref_json,'$.cwd') IS NOT (SELECT root_path FROM projects WHERE id=NEW.project_id) BEGIN SELECT RAISE(ABORT,'native cwd differs from project'); END;
  CREATE TRIGGER projects_root_referenced BEFORE UPDATE OF root_path ON projects WHEN NEW.root_path IS NOT OLD.root_path AND EXISTS(SELECT 1 FROM sessions WHERE project_id=OLD.id) BEGIN SELECT RAISE(ABORT,'project is referenced'); END;
