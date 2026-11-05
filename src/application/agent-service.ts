import { createHash } from "node:crypto";
import { DomainError } from "@/domain/errors";
import { emptyCapabilities, validateDefinition } from "@/domain/agent-definition";
import {renderAgentMarkdown} from "@/domain/agent-markdown";
import type { AgentDefinition } from "@/domain/models";

export type AgentCandidate = {
  markdown:string;
  name: string;
  description: string | null;
  definition: AgentDefinition;
  warnings: string[];
  sources: Array<{path:string;hash:string}>;
};
type Material = {path:string;hash:string;content:string};
type PreparationMode = "import" | "generate" | "revise";
function redactSource(value:string){
  return value.replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+\S{12,})\b/g,"[已遮蔽]").replace(/((?:OPENAI|API|ACCESS|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\s*[:=]\s*)[^\s,;"']{8,}/gi,"$1[已遮蔽]").replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,"[私钥内容已遮蔽]");
}

function boundedText(value: unknown, field: string, limit: number, required = false): string {
  if (typeof value !== "string" || required && !value.trim() || [...value].length > limit) throw new DomainError("INVALID_ROLE", `${field}不能为空或超过 ${limit} 字符`, 422, true);
  return value;
}

function candidate(value: unknown, kind: "coordinator" | "project", sources: Material[], priorWarnings: string[]): AgentCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("ROLE_GENERATION_INVALID", "模型未返回角色草稿", 422, true);
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !["name", "description", "instructions", "warnings"].includes(k))) throw new DomainError("ROLE_GENERATION_INVALID", "模型返回未知字段", 422, true);
  const name = boundedText(v.name, "角色名称", 120, true),
    description = v.description === null ? null : boundedText(v.description, "角色说明", 2000),
    instructions = boundedText(v.instructions, "角色指导", 16000, true);
  if (!Array.isArray(v.warnings) || v.warnings.length > 20 || v.warnings.some(x => typeof x !== "string" || [...x].length > 500)) throw new DomainError("ROLE_GENERATION_INVALID", "模型返回的说明格式无效", 422, true);
  const definition=validateDefinition({instructions,capabilities:emptyCapabilities()},kind);
  return {
    markdown:renderAgentMarkdown({agentId:"candidate",revision:1,kind,name,description,definition}),
    name,
    description,
    definition,
    warnings: [...priorWarnings, ...v.warnings as string[]].slice(0, 40),
    sources: sources.map(({path,hash}) => ({path,hash}))
  };
}

export function createAgentPreparationService(d: {
  collect: (projectId: string, signal?: AbortSignal, requirements?: string) => Promise<{sources:Material[];warnings:string[]}>;
  generate: (input: string, signal: AbortSignal, mode:PreparationMode) => Promise<string>;
}) {
  return {
    async prepare(body: Record<string, unknown>, signal: AbortSignal): Promise<AgentCandidate> {
      if (signal.aborted) throw new DomainError("REQUEST_ABORTED", "角色整理已取消", 409, true);
      if (Object.keys(body).some(k => !["kind","mode","markdown","fileName","projectId","referenceFiles","requirements","feedback","currentDraft"].includes(k))) throw new DomainError("INVALID_INPUT", "角色准备请求包含未支持字段", 400, true);
      const kind = body.kind;
      if (kind !== "coordinator" && kind !== "project") throw new DomainError("INVALID_ROLE", "请选择角色用途", 422, true);
      if(!["import","generate","revise"].includes(String(body.mode)))throw new DomainError("INVALID_INPUT","请选择有效整理模式",400,true);
      if(body.projectId!==undefined&&(typeof body.projectId!=="string"||!body.projectId)||body.markdown!==undefined&&typeof body.markdown!=="string")throw new DomainError("INVALID_INPUT","参考材料参数无效",400,true);
      const mode=body.mode as PreparationMode;
      if(body.fileName!==undefined&&typeof body.fileName!=='string')throw new DomainError('INVALID_INPUT','上传文件名无效',400,true);
      const requirements = boundedText(body.requirements ?? "", "角色要求", 2000),
        feedback = boundedText(body.feedback ?? "", "修改意见", 4000),
        sources:Material[] = [], warnings:string[] = [];
      if (mode === "revise" && !feedback.trim()) throw new DomainError("INVALID_ROLE", "请先输入修改意见", 422, true);
      if (typeof body.markdown === "string") {
        if(Buffer.byteLength(body.markdown)>65536)throw new DomainError("ROLE_INPUT_TOO_LARGE","Markdown超过64KiB",413,true);
        const markdown=boundedText(body.markdown,'参考 Markdown',65536,true);
        sources.push({path: typeof body.fileName === "string" ? (boundedText(body.fileName,"文件名",256).split(/[\\/]/).at(-1)??'上传的 Markdown') : "上传的 Markdown",content:markdown,hash:createHash("sha256").update(markdown).digest("hex")});
      }
      if (typeof body.projectId === "string" && body.projectId) {
        const collected = await d.collect(body.projectId, signal, requirements || feedback);
        sources.push(...collected.sources);
        warnings.push(...collected.warnings);
      }
      if (body.referenceFiles !== undefined) {
        if (!Array.isArray(body.referenceFiles) || body.referenceFiles.length > 8) throw new DomainError("INVALID_ROLE", "参考文件最多 8 个", 422, true);
        let total = 0;
        for (const [index,item] of body.referenceFiles.entries()) {
          if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some(k => !["name","content"].includes(k))) throw new DomainError("INVALID_ROLE", "参考文件格式无效", 422, true);
          const row = item as Record<string,unknown>;if(typeof row.content==='string'&&Buffer.byteLength(row.content)>65536)throw new DomainError('ROLE_INPUT_TOO_LARGE','单份参考文件超过64KiB',413,true);
          const name=boundedText(row.name,'参考文件名',256,true).split(/[\\/]/).at(-1)??'上传文件',content=boundedText(row.content,'参考文件内容',65536,true);
          if(Buffer.byteLength(content)>65536)throw new DomainError("ROLE_INPUT_TOO_LARGE","单份参考文件超过64KiB",413,true);
          total += Buffer.byteLength(content, "utf8");
          if (total > 262144) throw new DomainError("ROLE_INPUT_TOO_LARGE", "参考文件总量超过 256KiB", 413, true);
          sources.push({path:`[上传参考文件 ${index+1}] ${name}`,hash:createHash("sha256").update(content).digest("hex"),content});
        }
      }
      let previous: {name:string;description:string|null;instructions:string}|null = null;
      if (mode === "revise") {
        if(!feedback.trim())throw new DomainError('ROLE_MATERIALS_UNAVAILABLE','请提供修改意见',422,true);
        if (!body.currentDraft || typeof body.currentDraft !== "object" || Array.isArray(body.currentDraft)) throw new DomainError("INVALID_ROLE", "缺少当前角色草稿", 422, true);
        const draft = body.currentDraft as Record<string,unknown>;
        if(Object.keys(draft).some(key=>!["name","description","instructions"].includes(key)))throw new DomainError("INVALID_INPUT","草稿包含未知字段",400,true);
        previous = {
          name: boundedText(draft.name,"当前角色名称",120,true),
          description: draft.description === null ? null : boundedText(draft.description,"当前角色说明",2000),
          instructions: boundedText(draft.instructions,"当前角色指导",16000,true)
        };
      }
      let redacted=false;
      for(const source of sources){const safe=redactSource(source.content);if(safe!==source.content){source.content=safe;redacted=true;}}
      if(redacted)warnings.push("参考材料中的疑似凭据或私钥已在发送给模型前遮蔽。");
      if (mode === "generate" && !sources.length && !requirements.trim()) throw new DomainError("ROLE_MATERIALS_UNAVAILABLE", "请描述角色目标，或选择项目、上传参考文件", 422, true);
      if (signal.aborted) throw new DomainError("REQUEST_ABORTED", "角色整理已取消", 409, true);
      const input = JSON.stringify({mode,kind,requirements,feedback,previous,sources});
      if(mode==="import"&&!body.markdown)throw new DomainError("ROLE_MATERIALS_UNAVAILABLE","请提供Markdown",422,true);
      const raw = await d.generate(input, signal, mode);
      if (signal.aborted) throw new DomainError("REQUEST_ABORTED", "角色整理已取消", 409, true);
      let parsed: unknown;
      try { parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")); }
      catch { throw new DomainError("ROLE_GENERATION_INVALID", "模型未返回合法角色候选", 422, true); }
      try{return candidate(parsed, kind, sources, warnings);}catch(error){if(error instanceof DomainError&&error.code!=='ROLE_GENERATION_INVALID')throw new DomainError('ROLE_GENERATION_INVALID','模型候选不符合Agent字段约束',422,true);throw error;}
    }
  };
}
