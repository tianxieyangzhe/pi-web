export type AssistantSource = {kind:'project';projectId:string}|{kind:'workspace';workspaceId:string;projectIds:string[]};
export type UnifiedAssistantDefinition={format:4;scope:'global'|'project'|'workspace';source:null|{kind:'project';projectId:string}|{kind:'workspace';workspaceId:string;projectIds:string[]|null};systemPromptMode:'inherit'|'replace';systemPrompt:string};
export function isUnifiedAssistant(value:unknown):value is UnifiedAssistantDefinition{return !!value&&typeof value==='object'&&'format' in value&&value.format===4;}
export type AssistantDefinition = {
  format:3; mode:'generated'|'custom'; scope:'project'|'workspace';
  systemPrompt:string; source:AssistantSource|null;
  /** Historical read compatibility only; new generated assistants contain project files exclusively. */
  workspaceRules?:string;
  projects:Array<{id:string;name:string;rules:string}>;
};
/** Read-only compatibility with the former combined prompt format. */
export type LegacyAssistantDefinition = Omit<AssistantDefinition,'format'> & {format:2;instructions:string};
export const xmlText=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
export const unxmlText=(value:string)=>value.replace(/&(amp|lt|gt|quot|apos);/g,(_,c:string)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[c]!));
export type DocumentRange=[number,number];
function rawDocument(value:AssistantDefinition|LegacyAssistantDefinition) {
  let markdown='';
  const add=(text:string):DocumentRange|null=>{if(!text)return null;if(markdown)markdown+='\n\n';const start=markdown.length;markdown+=text;return [start,markdown.length];};
  const systemPrompt=add(value.systemPrompt),instructions=value.format===2?add(value.instructions):null;
  const workspaceRules=value.format===3?add(value.workspaceRules??''):null;
  const projects:Array<{id:string;name:string;range:DocumentRange}>=[];
  for(const project of value.projects){const range=add(project.rules);if(range)projects.push({id:project.id,name:project.name,range});}
  return {markdown,systemPrompt,instructions,workspaceRules,projects};
}
export function assistantDocument(value:AssistantDefinition) {return rawDocument(value);}
export function legacyAssistantDocument(value:LegacyAssistantDefinition) {return rawDocument(value);}
export function isAssistantDefinition(value:unknown):value is AssistantDefinition {return !!value&&typeof value==='object'&&'format' in value&&value.format===3;}
export function isLegacyAssistantDefinition(value:unknown):value is LegacyAssistantDefinition {return !!value&&typeof value==='object'&&'format' in value&&value.format===2;}
