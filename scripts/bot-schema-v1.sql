CREATE TABLE bots (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, working_directory TEXT NOT NULL,
 workspace_kind TEXT NOT NULL CHECK(workspace_kind IN ('managed','user_selected')), instructions TEXT NOT NULL,
 max_parallel_executions INTEGER NOT NULL CHECK(max_parallel_executions BETWEEN 1 AND 8),
 status TEXT NOT NULL CHECK(status IN ('active','disabled','archived')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE bot_conversations (
 id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE RESTRICT, title TEXT NOT NULL, goal TEXT NOT NULL,
 instructions_snapshot TEXT NOT NULL, work_state TEXT NOT NULL CHECK(work_state IN ('active','paused','completed','cancelled')),
 runtime_state TEXT NOT NULL CHECK(runtime_state IN ('not_started','starting','idle','running','interrupting','ended','unavailable')),
 native_ref TEXT CHECK(native_ref IS NULL OR (json_valid(native_ref) AND json_type(native_ref)='object')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_activity_at TEXT, UNIQUE(id,bot_id)
);
CREATE TABLE bot_conversation_sessions (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES bot_conversations(id) ON DELETE RESTRICT,
 session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE RESTRICT, role_key TEXT NOT NULL, role_name TEXT NOT NULL,
 responsibilities TEXT NOT NULL, origin TEXT NOT NULL CHECK(origin IN ('created','attached')),
 status TEXT NOT NULL CHECK(status IN ('active','disabled')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(conversation_id,role_key), UNIQUE(id,conversation_id)
);
CREATE TABLE bot_tasks (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES bot_conversations(id) ON DELETE RESTRICT,
 target_binding_id TEXT NOT NULL, title TEXT NOT NULL, instruction TEXT NOT NULL,
 acceptance_criteria TEXT NOT NULL CHECK(json_valid(acceptance_criteria) AND json_type(acceptance_criteria)='array'),
 operation TEXT NOT NULL CHECK(operation IN ('read','project_write')),
 state TEXT NOT NULL CHECK(state IN ('queued','running','waiting','completed','failed','cancelled','unavailable')),
 idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(conversation_id,idempotency_key), UNIQUE(id,conversation_id), UNIQUE(id,conversation_id,target_binding_id),
 FOREIGN KEY(target_binding_id,conversation_id) REFERENCES bot_conversation_sessions(id,conversation_id) ON DELETE RESTRICT
);
CREATE TABLE bot_task_dependencies (
 conversation_id TEXT NOT NULL, task_id TEXT NOT NULL, depends_on_task_id TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(task_id,depends_on_task_id), CHECK(task_id!=depends_on_task_id),
 FOREIGN KEY(task_id,conversation_id) REFERENCES bot_tasks(id,conversation_id) ON DELETE RESTRICT,
 FOREIGN KEY(depends_on_task_id,conversation_id) REFERENCES bot_tasks(id,conversation_id) ON DELETE RESTRICT
);
CREATE TABLE bot_executions (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES bot_conversations(id) ON DELETE RESTRICT,
 target_binding_id TEXT, task_id TEXT, kind TEXT NOT NULL CHECK(kind IN ('coordinator','task','interaction')),
 attempt_number INTEGER NOT NULL CHECK(attempt_number>=1), instruction_snapshot TEXT NOT NULL, role_instructions_snapshot TEXT NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN ('read','project_write')),
 state TEXT NOT NULL CHECK(state IN ('queued','starting','running','interrupting','completed','failed','cancelled','unavailable')),
 idempotency_key TEXT NOT NULL, native_start_entry_id TEXT, native_end_entry_id TEXT,
 result_json TEXT CHECK(result_json IS NULL OR (json_valid(result_json) AND json_type(result_json)='object')),
 error_code TEXT, error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
 CHECK((kind='coordinator' AND target_binding_id IS NULL AND task_id IS NULL) OR (kind='task' AND target_binding_id IS NOT NULL AND task_id IS NOT NULL) OR (kind='interaction' AND target_binding_id IS NOT NULL AND task_id IS NULL)),
 UNIQUE(task_id,attempt_number), UNIQUE(conversation_id,idempotency_key), UNIQUE(id,conversation_id),
 FOREIGN KEY(target_binding_id,conversation_id) REFERENCES bot_conversation_sessions(id,conversation_id) ON DELETE RESTRICT,
 FOREIGN KEY(task_id,conversation_id,target_binding_id) REFERENCES bot_tasks(id,conversation_id,target_binding_id) ON DELETE RESTRICT
);
CREATE TABLE bot_messages (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES bot_conversations(id) ON DELETE RESTRICT, task_id TEXT,
 source_kind TEXT NOT NULL CHECK(source_kind IN ('user','coordinator','project_session','service')), source_binding_id TEXT, source_execution_id TEXT,
 target_binding_id TEXT, reply_to_message_id TEXT, kind TEXT NOT NULL CHECK(kind IN ('instruction','question','answer','result','intervention')),
 content TEXT NOT NULL, delivery_mode TEXT NOT NULL CHECK(delivery_mode IN ('when_idle','steer')),
 state TEXT NOT NULL CHECK(state IN ('queued','delivering','delivered','failed','cancelled','unavailable')),
 execution_id TEXT, target_native_entry_id TEXT, idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, delivered_at TEXT,
 CHECK((source_kind='project_session' AND source_binding_id IS NOT NULL) OR (source_kind!='project_session' AND source_binding_id IS NULL)),
 CHECK(source_kind!='user' OR source_execution_id IS NULL),
 CHECK(kind!='result' OR (source_kind='service' AND source_execution_id IS NOT NULL AND target_binding_id IS NULL)),
 CHECK(delivery_mode!='steer' OR (source_kind='user' AND execution_id IS NOT NULL)),
 UNIQUE(conversation_id,idempotency_key), UNIQUE(id,conversation_id),
 FOREIGN KEY(task_id,conversation_id) REFERENCES bot_tasks(id,conversation_id) ON DELETE RESTRICT,
 FOREIGN KEY(source_binding_id,conversation_id) REFERENCES bot_conversation_sessions(id,conversation_id) ON DELETE RESTRICT,
 FOREIGN KEY(target_binding_id,conversation_id) REFERENCES bot_conversation_sessions(id,conversation_id) ON DELETE RESTRICT,
 FOREIGN KEY(reply_to_message_id,conversation_id) REFERENCES bot_messages(id,conversation_id) ON DELETE RESTRICT,
 FOREIGN KEY(source_execution_id,conversation_id) REFERENCES bot_executions(id,conversation_id) ON DELETE RESTRICT,
 FOREIGN KEY(execution_id,conversation_id) REFERENCES bot_executions(id,conversation_id) ON DELETE RESTRICT
);
CREATE INDEX bot_conversations_owner_idx ON bot_conversations(bot_id,last_activity_at,id);
CREATE INDEX bot_bindings_owner_idx ON bot_conversation_sessions(conversation_id,status,created_at);
CREATE INDEX bot_tasks_queue_idx ON bot_tasks(conversation_id,state,created_at);
CREATE INDEX bot_dependencies_reverse_idx ON bot_task_dependencies(depends_on_task_id,task_id);
CREATE INDEX bot_executions_queue_idx ON bot_executions(conversation_id,state,created_at);
CREATE INDEX bot_messages_queue_idx ON bot_messages(conversation_id,state,created_at);
CREATE INDEX bot_messages_target_idx ON bot_messages(target_binding_id,state,created_at);
CREATE UNIQUE INDEX bot_project_execution_active_idx ON bot_executions(target_binding_id) WHERE target_binding_id IS NOT NULL AND state IN ('starting','running','interrupting','unavailable');
CREATE UNIQUE INDEX bot_coordinator_execution_active_idx ON bot_executions(conversation_id) WHERE target_binding_id IS NULL AND state IN ('starting','running','interrupting','unavailable');
CREATE TRIGGER bot_directory_immutable BEFORE UPDATE OF working_directory,workspace_kind ON bots WHEN NEW.working_directory IS NOT OLD.working_directory OR NEW.workspace_kind IS NOT OLD.workspace_kind BEGIN SELECT RAISE(ABORT,'bot directory is immutable'); END;
CREATE TRIGGER bot_conversation_owner_immutable BEFORE UPDATE ON bot_conversations WHEN NEW.bot_id IS NOT OLD.bot_id OR NEW.instructions_snapshot IS NOT OLD.instructions_snapshot OR (OLD.native_ref IS NOT NULL AND NEW.native_ref IS NOT OLD.native_ref) BEGIN SELECT RAISE(ABORT,'conversation owner and native identity are immutable'); END;
CREATE TRIGGER bot_binding_immutable BEFORE UPDATE ON bot_conversation_sessions WHEN NEW.conversation_id IS NOT OLD.conversation_id OR NEW.session_id IS NOT OLD.session_id OR NEW.role_key IS NOT OLD.role_key OR NEW.origin IS NOT OLD.origin BEGIN SELECT RAISE(ABORT,'binding is immutable'); END;
CREATE TRIGGER bot_binding_no_delete BEFORE DELETE ON bot_conversation_sessions BEGIN SELECT RAISE(ABORT,'binding history must be retained'); END;
CREATE TRIGGER bot_task_immutable BEFORE UPDATE ON bot_tasks WHEN NEW.conversation_id IS NOT OLD.conversation_id OR NEW.target_binding_id IS NOT OLD.target_binding_id OR NEW.instruction IS NOT OLD.instruction OR NEW.acceptance_criteria IS NOT OLD.acceptance_criteria OR NEW.operation IS NOT OLD.operation OR NEW.idempotency_key IS NOT OLD.idempotency_key BEGIN SELECT RAISE(ABORT,'task definition is immutable'); END;
CREATE TRIGGER bot_execution_immutable BEFORE UPDATE ON bot_executions WHEN NEW.conversation_id IS NOT OLD.conversation_id OR NEW.target_binding_id IS NOT OLD.target_binding_id OR NEW.task_id IS NOT OLD.task_id OR NEW.kind IS NOT OLD.kind OR NEW.attempt_number IS NOT OLD.attempt_number OR NEW.instruction_snapshot IS NOT OLD.instruction_snapshot OR NEW.role_instructions_snapshot IS NOT OLD.role_instructions_snapshot OR NEW.operation IS NOT OLD.operation OR NEW.idempotency_key IS NOT OLD.idempotency_key OR (OLD.state IN ('completed','failed','cancelled') AND NEW.state IS NOT OLD.state) BEGIN SELECT RAISE(ABORT,'execution definition is immutable'); END;
CREATE TRIGGER bot_message_immutable BEFORE UPDATE ON bot_messages WHEN NEW.conversation_id IS NOT OLD.conversation_id OR NEW.task_id IS NOT OLD.task_id OR NEW.source_kind IS NOT OLD.source_kind OR NEW.source_binding_id IS NOT OLD.source_binding_id OR NEW.source_execution_id IS NOT OLD.source_execution_id OR NEW.target_binding_id IS NOT OLD.target_binding_id OR NEW.reply_to_message_id IS NOT OLD.reply_to_message_id OR NEW.kind IS NOT OLD.kind OR NEW.content IS NOT OLD.content OR NEW.delivery_mode IS NOT OLD.delivery_mode OR NEW.idempotency_key IS NOT OLD.idempotency_key OR (OLD.execution_id IS NOT NULL AND NEW.execution_id IS NOT OLD.execution_id) BEGIN SELECT RAISE(ABORT,'message definition is immutable'); END;
CREATE TRIGGER bot_dependency_cycle BEFORE INSERT ON bot_task_dependencies BEGIN
 SELECT CASE WHEN EXISTS(WITH RECURSIVE chain(id) AS (SELECT NEW.depends_on_task_id UNION SELECT d.depends_on_task_id FROM bot_task_dependencies d JOIN chain c ON d.task_id=c.id) SELECT 1 FROM chain WHERE id=NEW.task_id) THEN RAISE(ABORT,'dependency cycle') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM bot_executions WHERE task_id=NEW.task_id AND state!='queued') THEN RAISE(ABORT,'task already started') END;
END;
CREATE TRIGGER bot_dependency_no_update BEFORE UPDATE ON bot_task_dependencies BEGIN SELECT RAISE(ABORT,'dependencies are immutable'); END;
CREATE TRIGGER bot_dependency_no_delete BEFORE DELETE ON bot_task_dependencies WHEN EXISTS(SELECT 1 FROM bot_executions WHERE task_id=OLD.task_id AND state!='queued') BEGIN SELECT RAISE(ABORT,'task already started'); END;
CREATE TRIGGER bot_message_source_insert BEFORE INSERT ON bot_messages WHEN NEW.source_execution_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM bot_executions e WHERE e.id=NEW.source_execution_id AND e.conversation_id=NEW.conversation_id AND (NEW.source_kind='service' OR e.target_binding_id IS NEW.source_binding_id) AND (NEW.kind!='result' OR e.result_json IS NOT NULL)) BEGIN SELECT RAISE(ABORT,'invalid message source'); END;
CREATE TRIGGER bot_message_target_update BEFORE UPDATE OF execution_id ON bot_messages WHEN NEW.execution_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM bot_executions e WHERE e.id=NEW.execution_id AND e.conversation_id=NEW.conversation_id AND e.target_binding_id IS NEW.target_binding_id) BEGIN SELECT RAISE(ABORT,'invalid message target'); END;
CREATE TRIGGER bot_message_target_insert BEFORE INSERT ON bot_messages WHEN NEW.execution_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM bot_executions e WHERE e.id=NEW.execution_id AND e.conversation_id=NEW.conversation_id AND e.target_binding_id IS NEW.target_binding_id) BEGIN SELECT RAISE(ABORT,'invalid message target'); END;
CREATE TRIGGER bot_binding_duties_busy BEFORE UPDATE OF responsibilities ON bot_conversation_sessions WHEN NEW.responsibilities IS NOT OLD.responsibilities AND EXISTS(SELECT 1 FROM bot_executions e WHERE e.target_binding_id=OLD.id AND e.state IN ('starting','running','interrupting','unavailable')) BEGIN SELECT RAISE(ABORT,'role is busy'); END;
CREATE TRIGGER bot_execution_waiting_source BEFORE UPDATE OF result_json ON bot_executions WHEN NEW.result_json IS NOT NULL AND json_extract(NEW.result_json,'$.waitingForMessageId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM bot_messages m WHERE m.id=json_extract(NEW.result_json,'$.waitingForMessageId') AND m.conversation_id=NEW.conversation_id AND m.task_id=NEW.task_id AND m.source_execution_id=NEW.id AND m.kind='question') BEGIN SELECT RAISE(ABORT,'waiting message does not belong to execution'); END;

CREATE TRIGGER bot_execution_terminal BEFORE UPDATE ON bot_executions WHEN OLD.state IN ('completed','failed','cancelled') BEGIN SELECT RAISE(ABORT,'terminal execution must not be overwritten'); END;
CREATE TRIGGER bots_retain BEFORE DELETE ON bots BEGIN SELECT RAISE(ABORT,'bot history must be retained'); END;
CREATE TRIGGER bot_conversations_retain BEFORE DELETE ON bot_conversations BEGIN SELECT RAISE(ABORT,'conversation history must be retained'); END;
CREATE TRIGGER bot_tasks_retain BEFORE DELETE ON bot_tasks BEGIN SELECT RAISE(ABORT,'task history must be retained'); END;
CREATE TRIGGER bot_executions_retain BEFORE DELETE ON bot_executions BEGIN SELECT RAISE(ABORT,'execution history must be retained'); END;
CREATE TRIGGER bot_messages_retain BEFORE DELETE ON bot_messages BEGIN SELECT RAISE(ABORT,'message history must be retained'); END;
