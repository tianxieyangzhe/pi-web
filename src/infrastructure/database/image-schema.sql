-- Current image workbench objects only. Existing databases require explicit upgrade.
CREATE TABLE image_conversations (
 id TEXT PRIMARY KEY, title TEXT NOT NULL,
 native_ref_json TEXT CHECK(native_ref_json IS NULL OR json_valid(native_ref_json)),
 draft_json TEXT CHECK(draft_json IS NULL OR (json_valid(draft_json) AND json_type(draft_json)='object')),
 discussion_json TEXT CHECK(discussion_json IS NULL OR (json_valid(discussion_json) AND json_type(discussion_json)='object')),
 receipts_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(receipts_json) AND json_type(receipts_json)='object'),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE image_tasks (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, name TEXT NOT NULL,
 draft_json TEXT CHECK(draft_json IS NULL OR (json_valid(draft_json) AND json_type(draft_json)='object')),
 plan_json TEXT CHECK(plan_json IS NULL OR (json_valid(plan_json) AND json_type(plan_json)='object')),
 plan_inputs_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(plan_inputs_json) AND json_type(plan_inputs_json)='array'),
 execution_json TEXT CHECK(execution_json IS NULL OR (json_valid(execution_json) AND json_type(execution_json)='object')),
 receipts_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(receipts_json) AND json_type(receipts_json)='object'),
 current_plan_id TEXT GENERATED ALWAYS AS (json_extract(plan_json,'$.id')) VIRTUAL,
 execution_id TEXT GENERATED ALWAYS AS (json_extract(execution_json,'$.id')) VIRTUAL,
 status TEXT GENERATED ALWAYS AS (coalesce(json_extract(execution_json,'$.status'),CASE WHEN plan_json IS NULL THEN 'awaiting_input' ELSE 'awaiting_confirmation' END)) VIRTUAL,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK(execution_json IS NULL OR json_extract(execution_json,'$.status') IN('queued','running','processing','completed','failed')),
 CHECK(execution_json IS NULL OR ((json_extract(execution_json,'$.status') IN('completed','failed'))=(json_extract(execution_json,'$.finished_at') IS NOT NULL)))
);
CREATE UNIQUE INDEX image_current_plan ON image_tasks(current_plan_id) WHERE current_plan_id IS NOT NULL;
CREATE UNIQUE INDEX image_current_execution ON image_tasks(execution_id) WHERE execution_id IS NOT NULL;
CREATE INDEX image_task_queue ON image_tasks(status,created_at,id);
CREATE INDEX image_tasks_conversation ON image_tasks(conversation_id,created_at,id);
CREATE TABLE image_assets (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL, execution_id TEXT,
 role TEXT NOT NULL CHECK(role IN('reference','provider_response','master','output')), source_asset_id TEXT, original_name TEXT NOT NULL, relative_path TEXT NOT NULL UNIQUE,
 output_key TEXT, sealed_at TEXT, sha256 TEXT, mime_type TEXT, width INTEGER, height INTEGER, byte_size INTEGER CHECK(byte_size IS NULL OR byte_size>=0),
 availability TEXT NOT NULL CHECK(availability IN('staging','ready','missing','corrupt')), created_at TEXT NOT NULL,
 root_asset_id TEXT, version_number INTEGER CHECK(version_number IS NULL OR version_number>=0), ready_at TEXT,
 max_version_number INTEGER NOT NULL DEFAULT 0 CHECK(max_version_number>=0), deleted_at TEXT,
 cleanup_state TEXT NOT NULL DEFAULT 'none' CHECK(cleanup_state IN('none','pending','done','failed')), cleanup_error TEXT,
 CHECK((root_asset_id IS NULL)=(version_number IS NULL)),
 CHECK(deleted_at IS NULL OR (role='output' AND root_asset_id IS NOT NULL)),
 CHECK(root_asset_id IS NULL OR role IN('reference','output')),
 CHECK(source_asset_id IS NULL OR role='reference'),
 CHECK(role='reference' OR execution_id IS NOT NULL), CHECK((role='output')=(output_key IS NOT NULL)),
 CHECK(sealed_at IS NULL OR (sha256 IS NOT NULL AND mime_type IS NOT NULL AND byte_size IS NOT NULL AND width IS NOT NULL AND width>0 AND height IS NOT NULL AND height>0)),
 CHECK(availability!='ready' OR (sealed_at IS NOT NULL AND sha256 IS NOT NULL AND mime_type IS NOT NULL AND byte_size IS NOT NULL AND width IS NOT NULL AND width>0 AND height IS NOT NULL AND height>0))
);
CREATE UNIQUE INDEX image_output_key ON image_assets(execution_id,output_key) WHERE role='output';
CREATE UNIQUE INDEX image_asset_version ON image_assets(task_id,root_asset_id,version_number) WHERE root_asset_id IS NOT NULL;
CREATE TRIGGER image_version_immutable BEFORE UPDATE OF root_asset_id,version_number,ready_at ON image_assets
 WHEN OLD.root_asset_id IS NOT NULL AND (NEW.root_asset_id IS NOT OLD.root_asset_id OR NEW.version_number IS NOT OLD.version_number OR NEW.ready_at IS NOT OLD.ready_at)
 BEGIN SELECT RAISE(ABORT,'image version immutable'); END;
CREATE TRIGGER image_version_counter BEFORE UPDATE OF max_version_number ON image_assets
 WHEN NEW.max_version_number<OLD.max_version_number BEGIN SELECT RAISE(ABORT,'image version counter cannot decrease'); END;
CREATE INDEX image_assets_task ON image_assets(task_id,created_at,id);
CREATE TRIGGER image_native_immutable BEFORE UPDATE OF native_ref_json ON image_conversations
 WHEN OLD.native_ref_json IS NOT NULL AND NEW.native_ref_json IS NOT OLD.native_ref_json BEGIN SELECT RAISE(ABORT,'image native identity immutable'); END;
CREATE TRIGGER image_task_owner BEFORE UPDATE OF id,conversation_id ON image_tasks BEGIN SELECT RAISE(ABORT,'image task owner immutable'); END;
CREATE TRIGGER image_asset_identity BEFORE UPDATE OF id,task_id,execution_id,role,source_asset_id,relative_path,output_key ON image_assets BEGIN SELECT RAISE(ABORT,'image asset identity immutable'); END;
CREATE TRIGGER image_asset_sealed BEFORE UPDATE OF sealed_at,sha256,mime_type,width,height,byte_size ON image_assets
 WHEN OLD.sealed_at IS NOT NULL AND (NEW.sealed_at IS NOT OLD.sealed_at OR NEW.sha256 IS NOT OLD.sha256 OR NEW.mime_type IS NOT OLD.mime_type OR NEW.width IS NOT OLD.width OR NEW.height IS NOT OLD.height OR NEW.byte_size IS NOT OLD.byte_size)
 BEGIN SELECT RAISE(ABORT,'image asset sealed'); END;
CREATE TRIGGER image_asset_state BEFORE UPDATE OF availability ON image_assets WHEN
 NOT(NEW.availability=OLD.availability OR (OLD.availability='staging' AND NEW.availability IN('ready','missing','corrupt')) OR (OLD.availability='ready' AND NEW.availability IN('missing','corrupt')))
 BEGIN SELECT RAISE(ABORT,'image asset terminal'); END;
