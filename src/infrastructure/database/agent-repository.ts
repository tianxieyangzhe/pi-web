import type { Agent, AgentDefinition } from "@/domain/models";
import { DomainError } from "@/domain/errors";
import { roleETag, validateDefinition } from "@/domain/agent-definition";
import type Database from "better-sqlite3";
import type {AgentRepositoryPort} from "@/application/ports/catalog";
import { entityId, now } from "./common";
import { readAgentVersion, writeAgentVersion } from "../agents/agent-file-store.server";

export function createAgentRepository(database:Database.Database,assertSchemaCompatible:()=>void=()=>{}):AgentRepositoryPort {
function assertRoles() {
  const columns = database.prepare("PRAGMA table_info(agents)").all() as Array<{name:string}>;
  if (!columns.some(x => x.name === "content_sha256") || !columns.some(x => x.name === "definition_json")) throw new DomainError("MIGRATION_REQUIRED", "角色 Markdown 结构需要离线迁移；旧内容已保留", 409, true);
}

function map(row: Record<string, unknown>): Agent {
  const id = String(row.id), kind = (row.kind ?? null) as Agent["kind"], revision = Number(row.revision),
    contentSha256 = row.content_sha256 == null ? null : String(row.content_sha256);
  let markdown:string|null=null;
  let definition: AgentDefinition | null = null, name = String(row.name), description = row.description as string | null;
  if (contentSha256 && kind) {
    const version = readAgentVersion(id, revision, contentSha256);
    if (version.kind !== kind || version.name !== name || version.description !== description) throw new DomainError("ROLE_FILE_INDEX_MISMATCH", "角色目录与 Agent.md 不一致", 409, true);
    definition = version.definition; markdown=version.markdown;
  }
  let legacySource:string|null=null;
  if(!contentSha256){
    try{
      const oldDefinition=row.definition_json?JSON.parse(String(row.definition_json)) as Record<string,unknown>:null,
        oldExtension=row.extension_json?JSON.parse(String(row.extension_json)) as Record<string,unknown>:null,
        instruction=typeof oldDefinition?.instructions==="string"?oldDefinition.instructions:typeof oldExtension?.instruction==="string"?oldExtension.instruction:null;
      if(instruction){
        legacySource=instruction;
        if(kind&&!definition){
          const oldCaps=oldDefinition?.capabilities as Record<string,unknown>|undefined,
            capabilities={readFiles:false,writeFiles:false,...oldCaps};
          try{definition=validateDefinition({instructions:instruction,capabilities},kind);}catch{definition=null;}
        }
      }
    }catch{legacySource=null;}
  }
  return {
    id,
    name,
    description,
    kind,
    projectId: row.project_id as string | null,
    sourceTemplateId: row.source_template_id as string | null,
    definition,
    legacySource,
    contentSha256, markdown,
    revision,
    status: row.status as Agent["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

type AgentWrite = Omit<Agent, "id" | "revision" | "createdAt" | "updatedAt" | "contentSha256">;

const repository:AgentRepositoryPort = {
  list(): Agent[] {
    assertRoles();
    return (database.prepare("SELECT * FROM agents ORDER BY name,id").all() as Record<string, unknown>[]).map(map);
  },
  get(id: string): Agent | null {
    assertRoles();
    const row = database.prepare("SELECT * FROM agents WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? map(row) : null;
  },
  getVersion(id: string, revision: number, sha256: string): Agent | null {
    const current = this.get(id);
    if (!current || !current.kind) return null;
    const file = readAgentVersion(id, revision, sha256);
    return { ...current, kind:file.kind, name:file.name, description:file.description, definition:file.definition, revision:file.revision, contentSha256:file.contentSha256 };
  },
  create(input: AgentWrite): Agent {
    assertRoles(); assertSchemaCompatible();
    if (!input.kind || !input.definition) throw new DomainError("INVALID_ROLE", "新角色必须有用途和完整定义", 422, true);
    if (input.projectId || input.sourceTemplateId) throw new DomainError("INVALID_ROLE", "Agent 定义独立保存；项目关系在Session中建立", 422, true);
    const id = entityId("agent"), revision = 1, date = now();
    const file = writeAgentVersion({ agentId:id, revision, kind:input.kind, name:input.name, description:input.description, definition:input.definition });
    try {
      database.transaction(() => {
        database.prepare("INSERT INTO agents(id,name,description,kind,project_id,source_template_id,definition_json,extension_json,policy_json,revision,content_sha256,status,created_at,updated_at) VALUES(?,?,?,?,NULL,NULL,NULL,'{}','{}',?,?,?, ?,?)").run(id,input.name,input.description,input.kind,revision,file.contentSha256,input.status,date,date);
      })();
    } catch (error) {
      // Keep the immutable candidate for review; only the committed index is executable.
      throw error;
    }
    return this.get(id)!;
  },
  update(id: string, patch: Partial<AgentWrite>, expected?: string): Agent | null {
    assertRoles(); assertSchemaCompatible();
    const current = this.get(id);
    if (!current) return null;
    if (!expected || roleETag(current) !== expected) throw new DomainError("WRITE_CONFLICT", "角色已更新或缺少条件凭据，请重新读取", 409, true);
    if (current.kind && patch.kind !== undefined && patch.kind !== current.kind || patch.projectId !== undefined && patch.projectId !== current.projectId || patch.sourceTemplateId !== undefined && patch.sourceTemplateId !== current.sourceTemplateId) throw new DomainError("INVALID_ROLE", "Agent 用途和绑定关系不在角色编辑器中修改", 409, true);
    const nextName = patch.name ?? current.name,
      nextDescription = patch.description === undefined ? current.description : patch.description,
      nextDefinition = patch.definition === undefined ? current.definition : patch.definition,
      nextStatus = patch.status ?? current.status;
    if (current.kind && !nextDefinition && (patch.name !== undefined || patch.description !== undefined || patch.definition !== undefined)) throw new DomainError("ROLE_NOT_CONFIGURED", "旧角色需要先通过 LLM 转换为 Agent.md", 409, true);
    const nextKind=patch.kind??current.kind;
    const contentChanged = !current.contentSha256 || current.name !== nextName || current.description !== nextDescription || JSON.stringify(current.definition) !== JSON.stringify(nextDefinition);
    let revision = current.revision, contentSha256 = current.contentSha256;
    if (contentChanged) {
      if (!nextKind || !nextDefinition) throw new DomainError("INVALID_ROLE", "角色定义不完整", 422, true);
      revision += 1;
      contentSha256 = writeAgentVersion({agentId:id,revision,kind:nextKind,name:nextName,description:nextDescription,definition:nextDefinition}).contentSha256;
    }
    const date = new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString();
    database.transaction(() => {
      const result = database.prepare("UPDATE agents SET name=?,description=?,revision=?,content_sha256=?,status=?,updated_at=?,kind=? WHERE id=? AND revision=? AND updated_at=?").run(nextName,nextDescription,revision,contentSha256,nextStatus,date,nextKind,id,current.revision,current.updatedAt);
      if (!result.changes) throw new DomainError("WRITE_CONFLICT", "角色已更新，请重新读取后再保存", 409, true);
    })();
    return this.get(id);
  },
  delete(id: string): boolean {
    assertRoles(); assertSchemaCompatible();
    const row = database.prepare("SELECT id FROM agents WHERE id=?").get(id);
    if (!row) return false;
    database.prepare("DELETE FROM agents WHERE id=?").run(id);
    return true;
  },
  isInUse(id: string): boolean {
    assertRoles();
    return !!database.prepare('SELECT 1 FROM sessions WHERE agent_id=? LIMIT 1').get(id);
  }
};

return repository;
}
