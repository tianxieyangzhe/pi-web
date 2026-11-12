import { assistantDocument, legacyAssistantDocument, isAssistantDefinition, isLegacyAssistantDefinition, isUnifiedAssistant, unxmlText, type AssistantDefinition, type LegacyAssistantDefinition, type DocumentRange } from "@/domain/assistant-document";
import { legacyXmlDocument } from './legacy-xml-document.server';
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DomainError } from "@/domain/errors";
import { validateDefinition } from "@/domain/agent-definition";
import { renderAgentMarkdown } from "@/domain/agent-markdown";
import type { AgentDefinition } from "@/domain/models";

export type AgentMarkdown = {
  agentId: string;
  revision: number;
  kind: "project";
  name: string;
  description: string | null;
  definition: AgentDefinition;
};

function rootPath() {
  return path.resolve(process.env.AI_WORKSPACE_AGENT_DIR ?? path.join(process.cwd(), "agents"));
}

function legacyRootPath() {
  return process.env.AI_WORKSPACE_AGENT_DIR === undefined ? path.resolve(process.cwd(), '.data', 'agents') : null;
}
function pathPresent(target:string) {
  try { lstatSync(target); return true; }
  catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error; }
}
function versionPresent(root:string,id:string,revision:number) {
  return pathPresent(path.join(root,id,String(revision)))||pathPresent(path.join(root,id,`${revision}.md`));
}
function assertNoHistoricalVersion(id:string,revision:number) {
  const legacy=legacyRootPath();
  if(legacy&&versionPresent(legacy,id,revision))throw new DomainError('WRITE_CONFLICT','历史版本已存在，不能在新目录重写',409,true);
}

function validId(value: string) {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new DomainError("INVALID_ROLE", "角色 ID 无效", 422, true);
}

export function serializeAgentMarkdown(value: AgentMarkdown): string {
  validId(value.agentId);
  const definition = validateDefinition(value.definition, value.kind);
  return renderAgentMarkdown({...value,definition});
}

function parseScalar(value: string): unknown {
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  try { return JSON.parse(value); } catch { throw new DomainError("ROLE_FILE_INVALID", "Agent.md frontmatter 格式无效", 409, true); }
}

export function parseAgentMarkdown(markdown: string): AgentMarkdown {
  if (Buffer.byteLength(markdown, "utf8") > 65536) throw new DomainError("ROLE_FILE_TOO_LARGE", "Agent.md 超过 64KiB", 413, true);
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new DomainError("ROLE_FILE_INVALID", "Agent.md 缺少应用规范 frontmatter", 409, true);
  const fields: Record<string, unknown> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!item || Object.hasOwn(fields, item[1])) throw new DomainError("ROLE_FILE_INVALID", "Agent.md frontmatter 含无效或重复字段", 409, true);
    fields[item[1]] = item[1] === "kind" ? item[2] : parseScalar(item[2]);
  }
  const allowed = ["agent_id", "revision", "kind", "name", "description", "capabilities"];
  if (Object.keys(fields).some(key => !allowed.includes(key)) || typeof fields.agent_id !== "string" || !Number.isInteger(fields.revision) || !["project"].includes(String(fields.kind)) || typeof fields.name !== "string" || fields.description !== null && typeof fields.description !== "string" || !fields.capabilities || typeof fields.capabilities !== "object" || Array.isArray(fields.capabilities)) {
    throw new DomainError("ROLE_FILE_INVALID", "Agent.md frontmatter 字段不符合规范", 409, true);
  }
  const agentId = fields.agent_id as string;
  validId(agentId);
  return {
    agentId,
    revision: fields.revision as number,
    kind: fields.kind as AgentMarkdown["kind"],
    name: fields.name as string,
    description: fields.description as string | null,
    definition: validateDefinition({ instructions: match[2].trim(), capabilities: fields.capabilities }, fields.kind as AgentMarkdown["kind"])
  };
}

export function agentVersionPath(agentId: string, revision: number) {
  validId(agentId);
  if (!Number.isInteger(revision) || revision < 1) throw new DomainError("ROLE_FILE_INVALID", "角色版本无效", 409, true);
  return path.join(rootPath(), agentId, `${revision}.md`);
}

export function writeAgentVersion(value: AgentMarkdown): { contentSha256: string; path: string } {
  if(isUnifiedAssistant(value.definition))return writeUnifiedVersion(value);
  if(isAssistantDefinition(value.definition)) return writeSplitVersion(value);
  if(isLegacyAssistantDefinition(value.definition)) return writeCurrentVersion(value);
  const target = agentVersionPath(value.agentId, value.revision);
  const directory = path.dirname(target);
  assertNoHistoricalVersion(value.agentId,value.revision);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const parentReal = realpathSync(directory);
  const rootReal = existsSync(rootPath()) ? realpathSync(rootPath()) : path.resolve(rootPath());
  if (parentReal !== rootReal && !parentReal.startsWith(rootReal + path.sep)) throw new DomainError("ROLE_FILE_INVALID", "角色文件路径越界", 409, true);
  const content = serializeAgentMarkdown(value);
  const contentSha256 = createHash("sha256").update(content).digest("hex");
  if (existsSync(target)) {
    const current = readFileSync(target);
    if (createHash("sha256").update(current).digest("hex") !== contentSha256) throw new DomainError("WRITE_CONFLICT", "该角色版本文件已存在且内容不同", 409, true);
    return { contentSha256, path: target };
  }
  const temp = path.join(directory, `.${value.revision}.${randomUUID()}.tmp`);
  try {
    const fd=openSync(temp,"wx",0o600);try{writeFileSync(fd,content);fsyncSync(fd);}finally{closeSync(fd);}
    try{linkSync(temp,target);unlinkSync(temp);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(createHash('sha256').update(readFileSync(target)).digest('hex')!==contentSha256)throw new DomainError('WRITE_CONFLICT','版本候选冲突，既有文件保持不变',409,true);unlinkSync(temp);}
    const parent=openSync(directory,"r");try{fsyncSync(parent);}finally{closeSync(parent);}
  } catch (error) {
    try { rmSync(temp, { force: true }); } catch {}
    throw error;
  }
  return { contentSha256, path: target };
}

export function readAgentVersion(agentId: string, revision: number, expectedSha256?: string | null): AgentMarkdown & { contentSha256: string; path: string; markdown:string } {
  agentVersionPath(agentId, revision);
  try {
    const legacy=legacyRootPath();
    const root=!versionPresent(rootPath(),agentId,revision)&&legacy&&versionPresent(legacy,agentId,revision)?legacy:rootPath();
    const target=path.join(root,agentId,`${revision}.md`);
    if(pathPresent(path.join(root,agentId,String(revision))))return readCurrentVersion(agentId,revision,expectedSha256,root);
    const info = lstatSync(target);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("not a regular file");
    const real = realpathSync(target), base = realpathSync(path.dirname(target)),rootReal=realpathSync(root);
    if ((!base.startsWith(rootReal+path.sep)&&base!==rootReal)||(!real.startsWith(base + path.sep) && real !== base)) throw new Error("path escape");
    const bytes = readFileSync(target);
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    if (expectedSha256 && expectedSha256 !== contentSha256) throw new DomainError("ROLE_FILE_HASH_MISMATCH", "Agent.md 版本摘要不匹配", 409, true);
    const parsed = parseAgentMarkdown(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (parsed.agentId !== agentId || parsed.revision !== revision) throw new DomainError("ROLE_FILE_IDENTITY_MISMATCH", "Agent.md 身份或版本不匹配", 409, true);
    return { ...parsed, contentSha256, path: target, markdown:new TextDecoder("utf-8",{fatal:true}).decode(bytes) };
  } catch (error) {
    throw new DomainError("ROLE_VERSION_MISSING", "Agent Markdown 版本缺失或不可读", 409, true);
  }
}

export function deleteAgentFiles(agentId: string) {
  validId(agentId);
  const target = path.join(rootPath(), agentId);
  if (!existsSync(target)) return;
  const info = lstatSync(target);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new DomainError("ROLE_FILE_INVALID", "角色版本目录无效", 409, true);
  rmSync(target, { recursive: true, force: false });
}

type CurrentMetadata = Omit<AgentMarkdown,'definition'> & {format:2|3|4;mode:AssistantDefinition['mode'];scope:AssistantDefinition['scope'];source:AssistantDefinition['source'];systemPrompt:DocumentRange|null;instructions?:DocumentRange|null;projects:Array<{id:string;name:string;range:DocumentRange}>};
function currentDigest(metadata:string,markdown:string){return createHash('sha256').update(metadata).update('\0').update(markdown).digest('hex');}
function writeCurrentVersion(value:AgentMarkdown){
  const definition=validateDefinition(value.definition,value.kind) as unknown as AssistantDefinition|LegacyAssistantDefinition;
  const document=definition.format===3?assistantDocument(definition):legacyAssistantDocument(definition), {definition:_,...identity}=value;
  const metadata:CurrentMetadata={...identity,format:definition.format===3?4:3,mode:definition.mode,scope:definition.scope,source:definition.source,systemPrompt:document.systemPrompt,...(definition.format===2?{instructions:document.instructions}:{}),projects:document.projects};
  const metadataText=JSON.stringify(metadata),contentSha256=currentDigest(metadataText,document.markdown);
  const parent=path.dirname(agentVersionPath(value.agentId,value.revision)),target=path.join(parent,String(value.revision));
  assertNoHistoricalVersion(value.agentId,value.revision);
  mkdirSync(parent,{recursive:true,mode:0o700});
  if(lstatSync(parent).isSymbolicLink()||!realpathSync(parent).startsWith(realpathSync(rootPath())+path.sep))throw new DomainError('ROLE_FILE_INVALID','助手目录无效',409,true);
  if(existsSync(target)){const old=readCurrentVersion(value.agentId,value.revision,contentSha256);return {contentSha256:old.contentSha256,path:old.path};}
  if(existsSync(agentVersionPath(value.agentId,value.revision)))throw new DomainError('WRITE_CONFLICT','已有历史版本不能覆盖',409,true);
  const candidate=path.join(parent,`.${value.revision}.${randomUUID()}.tmp`);mkdirSync(candidate,{mode:0o700});
  try{
    for(const [name,text] of [['AGENTS.md',document.markdown],['definition.json',metadataText]]){const fd=openSync(path.join(candidate,name),'wx',0o600);try{writeFileSync(fd,text);fsyncSync(fd);}finally{closeSync(fd);}}
    const fd=openSync(candidate,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
    renameSync(candidate,target);const directory=openSync(parent,'r');try{fsyncSync(directory);}finally{closeSync(directory);}
  }catch(error){if(existsSync(candidate))rmSync(candidate,{recursive:true});throw error;}
  return {contentSha256,path:path.join(target,'AGENTS.md')};
}
function readCurrentVersion(agentId:string,revision:number,expected?:string|null,root=rootPath()):AgentMarkdown & {contentSha256:string;path:string;markdown:string}{
  const directory=path.join(root,agentId,String(revision));
  if(lstatSync(directory).isSymbolicLink()||!realpathSync(directory).startsWith(realpathSync(root)+path.sep))throw new Error('invalid version directory');
  const read=(name:string)=>{const p=path.join(directory,name),stat=lstatSync(p);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1048576)throw new Error('invalid version file');return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(readFileSync(p));};
  const metadataText=read('definition.json');
  if(JSON.parse(metadataText).format===6){const value=JSON.parse(metadataText);const hash=bodyHash(metadataText);if(expected&&expected!==hash||value.agentId!==agentId||value.revision!==revision||!isUnifiedAssistant(value.definition))throw new Error('version mismatch');const definition=validateDefinition(value.definition,'project');return {agentId,revision,kind:'project',name:value.name,description:value.description,definition,contentSha256:hash,path:path.join(directory,'definition.json'),markdown:definition.systemPrompt??''};}
  if(JSON.parse(metadataText).format===5)return readSplitVersion(agentId,revision,directory,metadataText,read,expected);
  const markdown=read('AGENTS.md'),metadata=JSON.parse(metadataText) as CurrentMetadata;
  const contentSha256=currentDigest(metadataText,markdown);
  if(expected&&contentSha256!==expected||![2,3,4].includes(metadata.format)||metadata.agentId!==agentId||metadata.revision!==revision)throw new Error('version mismatch');
  const part=(range:DocumentRange|null)=>{if(range===null)return '';if(!Array.isArray(range)||range.length!==2||range.some(n=>!Number.isInteger(n))||range[0]<0||range[1]<range[0]||range[1]>markdown.length)throw new Error('invalid range');return markdown.slice(...range);};
  if(metadata.format===4&&Object.hasOwn(metadata,'instructions'))throw new Error('removed field');
  const definition={format:metadata.format===4?3:2,mode:metadata.mode,scope:metadata.scope,source:metadata.source,systemPrompt:part(metadata.systemPrompt),...(metadata.format===4?{}:{instructions:part(metadata.instructions??null)}),projects:metadata.projects.map(p=>({id:p.id,name:p.name,rules:metadata.format===2?unxmlText(part(p.range)):part(p.range)}))};
  const valid=validateDefinition(definition,'project');
  const rendered=metadata.format===4?assistantDocument(valid as unknown as AssistantDefinition):metadata.format===2?legacyXmlDocument(valid as unknown as LegacyAssistantDefinition):legacyAssistantDocument(valid as unknown as LegacyAssistantDefinition);
  if(rendered.markdown!==markdown||JSON.stringify(rendered.systemPrompt)!==JSON.stringify(metadata.systemPrompt)||(metadata.format!==4&&JSON.stringify(rendered.instructions)!==JSON.stringify(metadata.instructions))||JSON.stringify(rendered.projects)!==JSON.stringify(metadata.projects))throw new Error('document mismatch');
  return {agentId,revision,kind:'project',name:metadata.name,description:metadata.description,definition:valid,contentSha256,path:path.join(directory,'AGENTS.md'),markdown};
}

// Each rule owns one immutable Markdown file; metadata hashes every body.
const bodyHash=(text:string)=>createHash('sha256').update(text).digest('hex');
const projectBodyPath=(id:string)=>`projects/${bodyHash(id)}/AGENTS.md`;
const ruleBodyPath=(source:AssistantDefinition['source'],id:string)=>source?.kind==='workspace'?projectBodyPath(id):'AGENTS.md';
const systemBodyPath=(source:AssistantDefinition['source'])=>source?.kind==='workspace'?(source.projectIds[0]?projectBodyPath(source.projectIds[0]):'workspace/AGENTS.md'):'AGENTS.md';
type BodyFile={path:string;sha256:string};
type SplitMetadata=Omit<AgentMarkdown,'definition'> & {format:5;mode:AssistantDefinition['mode'];scope:AssistantDefinition['scope'];source:AssistantDefinition['source'];systemPrompt:BodyFile|null;workspaceRules:BodyFile|null;projects:Array<{id:string;name:string;file:BodyFile}>};
function splitDigest(text:string){return bodyHash(text);}
function writeSplitVersion(value:AgentMarkdown){
  const definition=validateDefinition(value.definition,value.kind) as unknown as AssistantDefinition;
  if(definition.mode==='custom'&&definition.source?.kind==='workspace'&&definition.source.projectIds.length)throw new DomainError('INVALID_ROLE','工作区自定义助手只能作用于工作区自身',422,true);
  if(definition.workspaceRules!==undefined)throw new DomainError('INVALID_ROLE','项目生成不能包含工作区自身规则',422,true);
  const files=new Map<string,string>();
  const add=(file:string,text:string):BodyFile|null=>{if(!text)return null;files.set(file,text);return {path:file,sha256:bodyHash(text)};};
  const {definition:_,...identity}=value;
  const metadata:SplitMetadata={...identity,format:5,mode:definition.mode,scope:definition.scope,source:definition.source,systemPrompt:add(systemBodyPath(definition.source),definition.systemPrompt),workspaceRules:definition.workspaceRules===undefined?null:add('workspace/AGENTS.md',definition.workspaceRules),projects:definition.projects.map(p=>({id:p.id,name:p.name,file:add(ruleBodyPath(definition.source,p.id),p.rules)!}))};
  const metadataText=JSON.stringify(metadata),contentSha256=splitDigest(metadataText);
  const parent=path.dirname(agentVersionPath(value.agentId,value.revision)),target=path.join(parent,String(value.revision));
  assertNoHistoricalVersion(value.agentId,value.revision);mkdirSync(parent,{recursive:true,mode:0o700});
  if(lstatSync(parent).isSymbolicLink()||!realpathSync(parent).startsWith(realpathSync(rootPath())+path.sep))throw new DomainError('ROLE_FILE_INVALID','助手目录无效',409,true);
  if(existsSync(target)){const old=readCurrentVersion(value.agentId,value.revision,contentSha256);return {contentSha256:old.contentSha256,path:old.path};}
  if(existsSync(agentVersionPath(value.agentId,value.revision)))throw new DomainError('WRITE_CONFLICT','已有版本不能覆盖',409,true);
  const candidate=path.join(parent,`.${value.revision}.${randomUUID()}.tmp`);mkdirSync(candidate,{mode:0o700});
  try{
    files.set('definition.json',metadataText);
    for(const [file,text] of files){const targetFile=path.join(candidate,file);mkdirSync(path.dirname(targetFile),{recursive:true,mode:0o700});const fd=openSync(targetFile,'wx',0o600);try{writeFileSync(fd,text);fsyncSync(fd);}finally{closeSync(fd);}}
    const dirs=[...new Set([...files.keys()].map(file=>path.dirname(path.join(candidate,file))))];
    for(const dir of dirs){const fd=openSync(dir,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
    renameSync(candidate,target);const fd=openSync(parent,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
  }catch(error){if(existsSync(candidate))rmSync(candidate,{recursive:true});throw error;}
  return {contentSha256,path:path.join(target,metadata.systemPrompt?.path??metadata.workspaceRules?.path??metadata.projects[0].file.path)};
}
function readSplitVersion(agentId:string,revision:number,directory:string,metadataText:string,read:(name:string)=>string,expected?:string|null):AgentMarkdown & {contentSha256:string;path:string;markdown:string}{
  const m=JSON.parse(metadataText) as SplitMetadata,contentSha256=splitDigest(metadataText);
  if(expected&&expected!==contentSha256||m.agentId!==agentId||m.revision!==revision||m.kind!=='project')throw new Error('version mismatch');
  const get=(file:BodyFile|null,allowed:string)=>{if(file===null)return '';if(!file||file.path!==allowed||!Object.keys(file).every(k=>['path','sha256'].includes(k)))throw new Error('invalid file');
    let current=directory;for(const segment of allowed.split('/').slice(0,-1)){current=path.join(current,segment);if(lstatSync(current).isSymbolicLink()||!lstatSync(current).isDirectory())throw new Error('invalid directory');}
    const text=read(file.path);if(bodyHash(text)!==file.sha256)throw new Error('body hash mismatch');return text;};
  const definition:AssistantDefinition={format:3,mode:m.mode,scope:m.scope,source:m.source,systemPrompt:get(m.systemPrompt,systemBodyPath(m.source)),...(m.workspaceRules?{workspaceRules:get(m.workspaceRules,'workspace/AGENTS.md')}:{}),projects:m.projects.map(p=>({id:p.id,name:p.name,rules:get(p.file,ruleBodyPath(m.source,p.id))}))};
  validateDefinition(definition,'project');
  return {agentId,revision,kind:'project',name:m.name,description:m.description,definition,contentSha256,path:path.join(directory,m.systemPrompt?.path??m.workspaceRules?.path??m.projects[0].file.path),markdown:assistantDocument(definition).markdown};
}

function writeUnifiedVersion(value:AgentMarkdown){
 const definition=validateDefinition(value.definition,value.kind),metadata=JSON.stringify({...value,definition,format:6}),contentSha256=bodyHash(metadata);
 const parent=path.dirname(agentVersionPath(value.agentId,value.revision)),target=path.join(parent,String(value.revision));assertNoHistoricalVersion(value.agentId,value.revision);
 mkdirSync(parent,{recursive:true,mode:0o700});if(lstatSync(parent).isSymbolicLink()||!realpathSync(parent).startsWith(realpathSync(rootPath())+path.sep))throw new DomainError('ROLE_FILE_INVALID','助手目录无效',409,true);
 if(pathPresent(target)){readCurrentVersion(value.agentId,value.revision,contentSha256);return {contentSha256,path:path.join(target,'definition.json')};}
 if(pathPresent(agentVersionPath(value.agentId,value.revision)))throw new DomainError('WRITE_CONFLICT','已有版本不能覆盖',409,true);
 const temp=path.join(parent,`.${value.revision}.${randomUUID()}.tmp`);mkdirSync(temp,{mode:0o700});
 try{const fd=openSync(path.join(temp,'definition.json'),'wx',0o600);try{writeFileSync(fd,metadata);fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,target);const d=openSync(parent,'r');try{fsyncSync(d);}finally{closeSync(d);}}catch(error){rmSync(temp,{recursive:true,force:true});throw error;}
 return {contentSha256,path:path.join(target,'definition.json')};
}
