import {DomainError} from '@/domain/errors';
import {isUnifiedAssistant,xmlText} from '@/domain/assistant-document';
import type {AgentSnapshot,Project} from '@/domain/models';
import {workspacePrompt,type WorkspaceRecord,type WorkspaceProject} from '@/domain/workspace';
import type {ProjectRulesStore} from './ports/project-rules';
const contexts=new Map<string,{key:string;prompt:string;projects?:WorkspaceProject[]}>();
function remember<T extends {key:string;prompt:string}>(value:T):T{if(contexts.size>=128)contexts.delete(contexts.keys().next().value!);contexts.set(value.key,value);return value;}
export function projectAssistantContext(assistant:AgentSnapshot|null,project:Project,store:ProjectRulesStore){
 if(!assistant||!isUnifiedAssistant(assistant.definition))return undefined;
 const source=assistant.definition.source;if(source===null)return undefined;if(source.kind!=='project'||source.projectId!==project.id)throw new DomainError('ROLE_BINDING_INVALID','助手不适用于此项目',409,true);
 const rule=store.read({scope:'project',projectId:project.id});
 const key=JSON.stringify([assistant.contentSha256,project.id,project.name,project.rootPath,rule.writeETag]);const cached=contexts.get(key);if(cached)return cached;
 const prompt=`<project id="${xmlText(project.id)}" name="${xmlText(project.name)}">\n<cwd>${xmlText(project.rootPath)}</cwd>${rule.enabled&&rule.markdown?`\n<rules>${xmlText(rule.markdown)}</rules>`:''}\n</project>`;
 return remember({key,prompt});
}
export function workspaceAssistantContext(assistant:AgentSnapshot|null,workspace:WorkspaceRecord,defaultProjectId:string,store:ProjectRulesStore,findProject:(id:string)=>Project|null){
 if(!assistant||!isUnifiedAssistant(assistant.definition))return undefined;
 const source=assistant.definition.source;if(source===null)return undefined;let projects:WorkspaceProject[];
 if(source.kind==='workspace'){
  if(source.workspaceId!==workspace.id)throw new DomainError('ROLE_BINDING_INVALID','助手属于其他工作区',409,true);
  projects=source.projectIds===null?workspace.projects:source.projectIds.map(id=>{const p=workspace.projects.find(p=>p.id===id);if(!p)throw new DomainError('ROLE_BINDING_INVALID','助手项目已移出工作区',409,true);return p;});
 }else{const sourceProject=findProject(source.projectId);projects=workspace.projects.filter(p=>p.id===source.projectId||sourceProject&&p.rootPath===sourceProject.rootPath);if(projects.length!==1)throw new DomainError('ROLE_BINDING_INVALID','助手项目不属于工作区',409,true);}
 const rules=new Map<string,string>(),versions:string[]=[];
 for(const p of projects){const r=store.read({scope:'workspace',workspaceId:workspace.id,projectId:p.id});versions.push(r.writeETag);if(r.enabled&&r.markdown)rules.set(p.id,r.markdown);}
 const key=JSON.stringify([assistant.contentSha256,workspace.id,workspace.name,defaultProjectId,projects,versions]);const cached=contexts.get(key);if(cached)return cached as {key:string;prompt:string;projects:WorkspaceProject[]};
 const prompt=workspacePrompt(workspace,defaultProjectId,rules,'',projects);
 return remember({key,prompt,projects});
}
