CREATE TABLE bot_projects (
 bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE RESTRICT,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 added_at TEXT NOT NULL,
 PRIMARY KEY(bot_id,project_id)
);
CREATE TABLE bot_project_agents (
 bot_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
 agent_revision INTEGER NOT NULL CHECK(agent_revision>=1),
 content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
 added_at TEXT NOT NULL,
 PRIMARY KEY(bot_id,project_id,agent_id),
 FOREIGN KEY(bot_id,project_id) REFERENCES bot_projects(bot_id,project_id) ON DELETE RESTRICT
);
CREATE TABLE bot_conversation_projects (
 bot_conversation_id TEXT NOT NULL REFERENCES bot_conversations(id) ON DELETE RESTRICT,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 added_at TEXT NOT NULL,
 PRIMARY KEY(bot_conversation_id,project_id)
);
CREATE TABLE bot_conversation_project_agents (
 bot_conversation_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
 agent_revision INTEGER NOT NULL CHECK(agent_revision>=1),
 content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
 added_at TEXT NOT NULL,
 PRIMARY KEY(bot_conversation_id,project_id,agent_id),
 FOREIGN KEY(bot_conversation_id,project_id) REFERENCES bot_conversation_projects(bot_conversation_id,project_id) ON DELETE RESTRICT
);

CREATE INDEX bot_projects_project_idx ON bot_projects(project_id,bot_id);
CREATE INDEX bot_project_agents_agent_idx ON bot_project_agents(agent_id,bot_id,project_id);
CREATE INDEX bot_conversation_projects_project_idx ON bot_conversation_projects(project_id,bot_conversation_id);
CREATE INDEX bot_conversation_project_agents_agent_idx ON bot_conversation_project_agents(agent_id,bot_conversation_id,project_id);

CREATE TRIGGER project_agent_binding_insert BEFORE INSERT ON bot_project_agents WHEN NOT EXISTS(SELECT 1 FROM agents WHERE id=NEW.agent_id AND kind='project' AND status='active' AND revision>=NEW.agent_revision) BEGIN SELECT RAISE(ABORT,'project binding requires an active project Agent'); END;
CREATE TRIGGER project_agent_binding_update BEFORE UPDATE ON bot_project_agents BEGIN SELECT RAISE(ABORT,'Agent bindings are replaced atomically'); END;
CREATE TRIGGER conversation_project_scope_update BEFORE UPDATE ON bot_conversation_projects BEGIN SELECT RAISE(ABORT,'conversation Project scope is immutable'); END;
CREATE TRIGGER conversation_project_agent_insert BEFORE INSERT ON bot_conversation_project_agents WHEN NOT EXISTS(SELECT 1 FROM bot_conversation_projects p JOIN agents a ON a.id=NEW.agent_id AND a.kind='project' WHERE p.bot_conversation_id=NEW.bot_conversation_id AND p.project_id=NEW.project_id AND NEW.agent_revision>=1 AND length(NEW.content_sha256)=64) BEGIN SELECT RAISE(ABORT,'conversation Agent requires a bound Project and project role'); END;
CREATE TRIGGER conversation_project_agent_update BEFORE UPDATE ON bot_conversation_project_agents WHEN NEW.bot_conversation_id IS NOT OLD.bot_conversation_id OR NEW.project_id IS NOT OLD.project_id OR NEW.agent_id IS NOT OLD.agent_id OR NEW.added_at IS NOT OLD.added_at OR NEW.agent_revision<OLD.agent_revision OR NOT EXISTS(SELECT 1 FROM agents WHERE id=NEW.agent_id AND kind='project' AND status='active' AND revision>=NEW.agent_revision) OR EXISTS(SELECT 1 FROM project_calls WHERE conversation_id=OLD.bot_conversation_id AND status IN ('accepted','working','unknown')) BEGIN SELECT RAISE(ABORT,'conversation Agent can be adopted only at a stable boundary'); END;
CREATE TRIGGER session_bot_agent_binding BEFORE UPDATE OF bot_conversation_id,agent_id,agent_snapshot_json ON sessions WHEN NEW.bot_conversation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM bot_conversation_project_agents a WHERE a.bot_conversation_id=NEW.bot_conversation_id AND a.project_id=NEW.project_id AND a.agent_id=NEW.agent_id AND a.agent_revision=json_extract(NEW.agent_snapshot_json,'$.revision') AND a.content_sha256=json_extract(NEW.agent_snapshot_json,'$.contentSha256')) BEGIN SELECT RAISE(ABORT,'project Agent is not bound to this Bot conversation'); END;
CREATE TRIGGER role_delete_retain BEFORE DELETE ON agents WHEN EXISTS(SELECT 1 FROM bots WHERE coordinator_agent_id=OLD.id) OR EXISTS(SELECT 1 FROM bot_conversations WHERE coordinator_agent_id=OLD.id) OR EXISTS(SELECT 1 FROM sessions WHERE agent_id=OLD.id) OR EXISTS(SELECT 1 FROM bot_project_agents WHERE agent_id=OLD.id) OR EXISTS(SELECT 1 FROM bot_conversation_project_agents WHERE agent_id=OLD.id) BEGIN SELECT RAISE(ABORT,'archive Agent while it is referenced'); END;
