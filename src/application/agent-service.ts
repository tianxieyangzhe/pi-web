import { DomainError } from '@/domain/errors';
import { DEFAULT_GENERATION_SKILL, type GenerationSkills } from './ports/generation-skills';
import { validateDefinition } from '@/domain/agent-definition';
import { assistantDocument, type AssistantDefinition, type AssistantSource } from '@/domain/assistant-document';
export type AgentMaterial={path:string;hash:string;content:string};
export type AgentSourceProject={id:string;name:string;rootPath:string};
export type AgentPreparationProgress={projectId:string;name:string;index:number;total:number;phase:'started'|'reading'|'completed';tool?:string};
export type AgentGenerationContext={cwd:string;onRead?:(tool:string)=>void};
export function parseAssistantSource(value:unknown):AssistantSource {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new DomainError('INVALID_INPUT','请选择参考范围',400,true);
  const v=value as Record<string,unknown>;
  if(v.kind==='project'&&Object.keys(v).every(k=>['kind','projectId'].includes(k))&&typeof v.projectId==='string'&&v.projectId)return {kind:'project',projectId:v.projectId};
  if(v.kind==='workspace'&&Object.keys(v).every(k=>['kind','workspaceId','projectIds'].includes(k))&&typeof v.workspaceId==='string'&&v.workspaceId&&Array.isArray(v.projectIds)&&v.projectIds.length<=32&&v.projectIds.every(id=>typeof id==='string'&&id)&&new Set(v.projectIds).size===v.projectIds.length)return {kind:'workspace',workspaceId:v.workspaceId,projectIds:v.projectIds as string[]};
  throw new DomainError('INVALID_INPUT','参考范围格式无效',400,true);
}
export function createAgentPreparationService(d:{skills:GenerationSkills;resolveSource:(source:AssistantSource)=>AgentSourceProject[];generate:(input:string,signal:AbortSignal,mode:'generate'|'revise',context?:AgentGenerationContext)=>Promise<string>}) {
  return {skills:()=>d.skills.list(),skill:(id:string)=>d.skills.read(id),async prepare(body:Record<string,unknown>,signal:AbortSignal,onProgress?:(event:AgentPreparationProgress)=>void){
    if(Object.keys(body).some(k=>!['mode','source','requirements','feedback','currentDraft','target','skillId','inputText'].includes(k))||!['generate','revise'].includes(String(body.mode)))throw new DomainError('INVALID_INPUT','助手生成请求格式无效',400,true);
    const text=(value:unknown,max:number)=>{if(typeof value!=='string'||value.length>max)throw new DomainError('INVALID_INPUT','输入内容无效或过长',400,true);return value;};
    const requirements=text(body.requirements??'',4000),feedback=text(body.feedback??'',4000);
    if(signal.aborted)throw new DomainError('REQUEST_ABORTED','已取消生成',409,true);
    const previous=body.currentDraft===undefined?null:validateDefinition(body.currentDraft,'project',true) as unknown as AssistantDefinition;
    if(previous&&previous.format!==3)throw new DomainError('INVALID_ROLE','请先转换旧助手',422,true);
    if(body.mode==='revise'&&(!previous||!feedback.trim()))throw new DomainError('INVALID_INPUT','请提供当前草稿和修改意见',400,true);
    const assistantMode=previous?.mode??'generated';
    const target=body.target??(body.mode==='revise'?'auto':assistantMode==='custom'?'systemPrompt':'projects');
    if(!['systemPrompt','projects','auto'].includes(String(target))||target==='auto'&&body.mode!=='revise'||target==='systemPrompt'&&assistantMode!=='custom'||target==='projects'&&assistantMode!=='generated')throw new DomainError('INVALID_INPUT','生成目标与助手创建方式不符',400,true);
    const inputText=body.inputText===undefined?undefined:text(body.inputText,262144);
    if(inputText!==undefined&&(assistantMode!=='custom'||body.mode!=='generate'||!inputText.trim()||inputText.includes('\0')||Buffer.byteLength(inputText)>262144))throw new DomainError('INVALID_INPUT','润色材料必须为非空文本且不超过256KiB',400,true);
    const source=body.source===undefined?(previous?.source??null):parseAssistantSource(body.source);
    if(assistantMode==='custom'&&source?.kind==='workspace'&&source.projectIds.length)throw new DomainError('INVALID_INPUT','工作区自定义助手只能作用于工作区自身',400,true);
    if(previous?.workspaceRules!==undefined)throw new DomainError('INVALID_INPUT','请先移除旧工作区规则，项目生成只包含项目文件',400,true);
    if(assistantMode==='generated'&&!source)throw new DomainError('ROLE_MATERIALS_UNAVAILABLE','请选择项目或工作区',422,true);
    if(assistantMode==='generated'&&previous?.source&&JSON.stringify(previous.source)!==JSON.stringify(source)&&body.mode==='revise')throw new DomainError('INVALID_INPUT','来源变化请重新生成项目规则',400,true);
    if(body.skillId!==undefined&&body.skillId!==null&&(typeof body.skillId!=='string'||!body.skillId))throw new DomainError('INVALID_INPUT','生成技能选择无效',400,true);
    if(assistantMode==='custom'&&body.skillId!=null)throw new DomainError('INVALID_INPUT','生成技能仅用于项目规则',400,true);
    const skill=assistantMode==='generated'&&body.skillId!==null?d.skills.read((body.skillId as string|undefined)??DEFAULT_GENERATION_SKILL):null;
    if(target==='projects'&&source?.kind==='workspace'&&!source.projectIds.length)throw new DomainError('INVALID_INPUT','请选择至少一个项目',400,true);
    const selected=source?d.resolveSource(source):[];
    if(target==='projects'&&!selected.length)throw new DomainError('INVALID_INPUT','请选择至少一个项目',400,true);
    const sources:AgentMaterial[]=[],warnings:string[]=[];
    const parse=(raw:string):Record<string,unknown>=>{
      const source=raw.replace(/```(?:json)?/gi,''),found:Record<string,unknown>[]=[];
      const walk=(from:number)=>{let depth=0,inString=false;for(let i=from;i<source.length;i++){const char=source[i];if(inString){if(char==='\\')i++;else if(char==='"')inString=false;continue;}if(char==='"')inString=true;else if(char==='{'){if(depth++===0)from=i;}else if(char==='}'&&depth&&--depth===0){try{const value=JSON.parse(source.slice(from,i+1));if(value&&typeof value==='object'&&!Array.isArray(value))found.push(value);}catch{/* keep scanning */}}}};
      for(let i=0;i<source.length;i++)if(source[i]==='{'){walk(i);break;}
      const allowed=['name','description','text','rules','warnings','changes'];
      const usable=found.filter(value=>typeof value.text==='string'||Array.isArray(value.rules)||!!value.changes&&typeof value.changes==='object'&&!Array.isArray(value.changes));
      const matches=usable.filter(value=>Object.keys(value).every(key=>allowed.includes(key)));
      if(matches.length!==1)throw new DomainError('ROLE_GENERATION_INVALID',raw,422,true);
      return matches[0];
    };
    let raw:string;
    if(assistantMode==='generated'){
      if(!selected.length)throw new DomainError('INVALID_INPUT','请选择至少一个项目',400,true);
      const rows:Array<{id:string;rules:string}>=[];let suggestedName='新助手';
      for(const [offset,project] of selected.entries()){
        if(signal.aborted)throw new DomainError('REQUEST_ABORTED','已取消生成',409,true);
        const progress={projectId:project.id,name:project.name,index:offset+1,total:selected.length};
        onProgress?.({...progress,phase:'started'});
        const localPrevious=previous?{...previous,scope:'project',source:{kind:'project',projectId:project.id},projects:previous.projects.filter(p=>p.id===project.id)}:null;
        const answer=parse(await d.generate(JSON.stringify({mode:body.mode,assistantMode,target,requirements,feedback,previous:localPrevious,projects:[{id:project.id,name:project.name}],skill}),signal,body.mode as 'generate'|'revise',{cwd:project.rootPath,onRead:tool=>onProgress?.({...progress,phase:'reading',tool})}));
        if(signal.aborted)throw new DomainError('REQUEST_ABORTED','已取消生成',409,true);
        if(Object.keys(answer).some(k=>!['name','description','rules','text','changes','warnings'].includes(k)))throw new DomainError('ROLE_GENERATION_INVALID','模型草稿字段无效',422,true);
        const changes=answer.changes as Record<string,unknown>|undefined;
        if(target==='auto'&&(!changes||typeof changes!=='object'||Array.isArray(changes)||Object.keys(changes).some(k=>k!=='rules')))throw new DomainError('ROLE_GENERATION_INVALID','项目修订只能返回项目规则',422,true);
        const value=target==='auto'?changes?.rules:answer.rules;
        if(!Array.isArray(value)||value.length!==1||!value[0]||Object.keys(value[0]).some(k=>!['id','rules'].includes(k))||value[0].id!==project.id||typeof value[0].rules!=='string'||!value[0].rules.trim())throw new DomainError('ROLE_GENERATION_INVALID','单项目生成必须返回该项目的完整规则',422,true);
        validateDefinition({format:3,mode:'generated',scope:'project',source:{kind:'project',projectId:project.id},systemPrompt:'',projects:[{id:project.id,name:project.name,rules:value[0].rules}]},'project');
        rows.push({id:project.id,rules:value[0].rules});
        if(typeof answer.name==='string'&&offset===0)suggestedName=answer.name;
        if(Array.isArray(answer.warnings))warnings.push(...answer.warnings.filter((w):w is string=>typeof w==='string').map(w=>project.name+'：'+w));
        onProgress?.({...progress,phase:'completed'});
      }
      raw=JSON.stringify({name:suggestedName,...(target==='auto'?{changes:{rules:rows}}:{rules:rows})});
    }else raw=await d.generate(JSON.stringify({mode:body.mode,assistantMode,target,requirements,feedback,inputText,previous,projects:[],skill:null}),signal,body.mode as 'generate'|'revise');
    if(signal.aborted)throw new DomainError('REQUEST_ABORTED','已取消生成',409,true);
    const result=parse(raw);
    if(Object.keys(result).some(k=>!['name','description','text','rules','warnings','changes'].includes(k)))throw new DomainError('ROLE_GENERATION_INVALID','模型草稿字段无效',422,true);
    const name=text(result.name??'新助手',120),description=result.description===null?null:text(result.description??'',2000);
    const definition:AssistantDefinition=previous?structuredClone(previous):{format:3,mode:'generated',scope:source?.kind==='workspace'?'workspace':'project',systemPrompt:'',source,projects:[]};
    if(body.source!==undefined){definition.source=source;definition.scope=source?.kind==='workspace'?'workspace':'project';}
    const assignRules=(value:unknown,partial:boolean)=>{
      if(!Array.isArray(value)||!value.length||!partial&&value.length!==selected.length)throw new DomainError('ROLE_GENERATION_INVALID','缺少项目规则',422,true);
      const changed=new Map<string,string>();
      for(const row of value){
        if(!row||typeof row!=='object'||Object.keys(row).some(k=>!['id','rules'].includes(k))||typeof row.id!=='string'||changed.has(row.id)||!selected.some(p=>p.id===row.id)||typeof row.rules!=='string'||!row.rules.trim())throw new DomainError('ROLE_GENERATION_INVALID','项目规则包含无效或重复项目',422,true);
        changed.set(row.id,row.rules);
      }
      definition.projects=selected.flatMap(p=>{const rules=changed.get(p.id)??(partial?definition.projects.find(row=>row.id===p.id)?.rules:undefined);return rules===undefined?[]:[{id:p.id,name:p.name,rules}];});
    };
    if(target==='auto'){
      const changes=result.changes;
      if(!changes||typeof changes!=='object'||Array.isArray(changes)||!Object.keys(changes).length||Object.keys(changes).some(k=>assistantMode==='custom'?k!=='systemPrompt':k!=='rules'))throw new DomainError('ROLE_GENERATION_INVALID','模型修改超出助手正文范围',422,true);
      const patch=changes as Record<string,unknown>;
      if(assistantMode==='custom')definition.systemPrompt=text(patch.systemPrompt,262144);
      else assignRules(patch.rules,true);
    }else if(target==='projects')assignRules(result.rules,false);
    else definition.systemPrompt=text(result.text,262144);
    validateDefinition(definition,'project');
    if(Array.isArray(result.warnings))warnings.push(...result.warnings.filter((w):w is string=>typeof w==='string').slice(0,20));
    const skillView=skill?(({content,...view})=>view)(skill):null;
    return {name,description,definition,markdown:assistantDocument(definition).markdown,warnings,skill:skillView,sources:sources.map(({path,hash})=>({path,hash}))};
  }};
}
