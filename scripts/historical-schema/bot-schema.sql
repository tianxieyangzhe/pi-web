CREATE TABLE bots (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, working_directory TEXT NOT NULL,
 workspace_kind TEXT NOT NULL CHECK(workspace_kind IN ('managed','user_selected')),
 coordinator_agent_id TEXT REFERENCES agents(id) ON DELETE RESTRICT,
 coordinator_agent_snapshot_json TEXT CHECK(coordinator_agent_snapshot_json IS NULL OR (json_valid(coordinator_agent_snapshot_json) AND json_type(coordinator_agent_snapshot_json)='object')),
 max_parallel_executions INTEGER NOT NULL CHECK(max_parallel_executions BETWEEN 1 AND 8),
 status TEXT NOT NULL CHECK(status IN ('active','disabled','archived')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK((coordinator_agent_id IS NULL)=(coordinator_agent_snapshot_json IS NULL))
);
CREATE TABLE bot_conversations (
 id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE RESTRICT, title TEXT NOT NULL,
 coordinator_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
 coordinator_agent_snapshot_json TEXT NOT NULL CHECK(json_valid(coordinator_agent_snapshot_json) AND json_type(coordinator_agent_snapshot_json)='object'),
 native_ref TEXT CHECK(native_ref IS NULL OR (json_valid(native_ref) AND json_type(native_ref)='object')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_activity_at TEXT, UNIQUE(id,bot_id)
);
CREATE TABLE project_calls (
 id TEXT PRIMARY KEY,
 conversation_id TEXT NOT NULL REFERENCES bot_conversations(id) ON DELETE RESTRICT,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 session_id TEXT REFERENCES sessions(id) ON DELETE RESTRICT,
 source_entry_id TEXT NOT NULL,
 sent_content TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('accepted','working','completed','aborted','unknown')),
 start_entry_id TEXT,
 end_entry_id TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CHECK((status='completed' AND start_entry_id IS NOT NULL AND end_entry_id IS NOT NULL) OR (status!='completed' AND end_entry_id IS NULL)),
 CHECK(status!='working' OR (session_id IS NOT NULL AND start_entry_id IS NOT NULL)),
 UNIQUE(conversation_id,project_id,source_entry_id,sent_content)
);
CREATE UNIQUE INDEX project_calls_session_active_idx ON project_calls(session_id) WHERE session_id IS NOT NULL AND status IN ('accepted','working');
CREATE UNIQUE INDEX project_calls_unknown_idx ON project_calls(conversation_id,project_id) WHERE status='unknown';
CREATE INDEX bot_conversations_owner_idx ON bot_conversations(bot_id,last_activity_at,id);
CREATE INDEX project_calls_queue_idx ON project_calls(conversation_id,project_id,status,created_at);
CREATE TRIGGER bot_directory_immutable BEFORE UPDATE ON bots WHEN NEW.working_directory IS NOT OLD.working_directory OR NEW.workspace_kind IS NOT OLD.workspace_kind BEGIN SELECT RAISE(ABORT,'bot directory is immutable'); END;
CREATE TRIGGER bot_conversation_owner_immutable BEFORE UPDATE ON bot_conversations WHEN NEW.bot_id IS NOT OLD.bot_id OR NEW.coordinator_agent_id IS NOT OLD.coordinator_agent_id OR (OLD.native_ref IS NOT NULL AND NEW.native_ref IS NOT OLD.native_ref) BEGIN SELECT RAISE(ABORT,'conversation owner and native identity are immutable'); END;
CREATE TRIGGER project_call_identity_immutable BEFORE UPDATE ON project_calls WHEN NEW.conversation_id IS NOT OLD.conversation_id OR NEW.project_id IS NOT OLD.project_id OR NEW.source_entry_id IS NOT OLD.source_entry_id OR NEW.sent_content IS NOT OLD.sent_content OR (OLD.session_id IS NOT NULL AND NEW.session_id IS NOT OLD.session_id) OR (OLD.start_entry_id IS NOT NULL AND NEW.start_entry_id IS NOT OLD.start_entry_id) OR (OLD.end_entry_id IS NOT NULL AND NEW.end_entry_id IS NOT OLD.end_entry_id) OR (OLD.status IN ('completed','aborted') AND NEW.status IS NOT OLD.status) BEGIN SELECT RAISE(ABORT,'project call identity is immutable'); END;
CREATE TRIGGER bots_retain BEFORE DELETE ON bots BEGIN SELECT RAISE(ABORT,'bot history must be retained'); END;
