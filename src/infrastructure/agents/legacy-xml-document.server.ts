import {xmlText,type LegacyAssistantDefinition,type DocumentRange} from '@/domain/assistant-document';

/** Historical storage layout, used only to verify immutable format-2 files. */
export function legacyXmlDocument(value:LegacyAssistantDefinition) {
  let markdown='';
  const add=(text:string):DocumentRange|null=>{if(!text)return null;if(markdown)markdown+='\n\n';const start=markdown.length;markdown+=text;return [start,markdown.length];};
  const systemPrompt=add(value.systemPrompt),instructions=add(value.instructions);
  const projects:Array<{id:string;name:string;range:DocumentRange}>=[];
  if(value.projects.length){
    if(markdown)markdown+='\n\n';
    if(value.scope==='workspace')markdown+=`<workspace id="${xmlText(value.source?.kind==='workspace'?value.source.workspaceId:'')}">\n  <projects>\n`;
    for(const project of value.projects){
      markdown+=`<project id="${xmlText(project.id)}" name="${xmlText(project.name)}">\n<rules>`;
      const start=markdown.length;markdown+=xmlText(project.rules);projects.push({id:project.id,name:project.name,range:[start,markdown.length]});
      markdown+='</rules>\n</project>\n';
    }
    if(value.scope==='workspace')markdown+='  </projects>\n</workspace>';
  }
  return {markdown,systemPrompt,instructions,projects};
}
