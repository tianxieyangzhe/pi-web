import 'server-only';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {DomainError} from '@/domain/errors';
import {DEFAULT_GENERATION_SKILL,type GenerationSkills,type GenerationSkillView} from '@/application/ports/generation-skills';

const validId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const unavailable = () => new DomainError('GENERATION_SKILL_UNAVAILABLE','无法读取生成技能，请检查项目 skills 目录',503,true);
function scalar(value:string):string {
  const text=value.trim();
  if(text.startsWith('"'))return JSON.parse(text);
  if(text.startsWith("'")){if(!text.endsWith("'"))throw unavailable();return text.slice(1,-1).replace(/''/g,"'");}
  return text;
}
export function createGenerationSkills(root=path.join(process.cwd(),'skills')):GenerationSkills {
  function read(id:string) {
    if(!validId.test(id)||id.length>100)throw new DomainError('INVALID_INPUT','生成技能标识无效',400,true);
    try {
      const directory=path.join(root,id),file=path.join(directory,'SKILL.md');
      if(!lstatSync(root).isDirectory()||lstatSync(root).isSymbolicLink()||!lstatSync(directory).isDirectory()||lstatSync(directory).isSymbolicLink())throw unavailable();
      const stat=lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>131072)throw unavailable();
      const bytes=readFileSync(file);if(bytes.length>131072)throw unavailable();
      const content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
      const header=/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
      if(!header||content.includes('\0'))throw unavailable();
      const names=[...header.matchAll(/^name:[ \t]*(.+)$/gm)],descriptions=[...header.matchAll(/^description:[ \t]*(.+)$/gm)];
      if(names.length!==1||descriptions.length!==1)throw unavailable();
      const name=scalar(names[0][1]),description=scalar(descriptions[0][1]);
      if(name!==id||typeof description!=='string'||!description.trim()||['|','>','|-','>-'].includes(description))throw unavailable();
      return {id,name,description,sha256:createHash('sha256').update(bytes).digest('hex'),content};
    }catch(error){
      if(error instanceof DomainError)throw error;
      if((error as NodeJS.ErrnoException).code==='ENOENT')throw new DomainError('GENERATION_SKILL_NOT_FOUND','生成技能不存在',404,true);
      throw unavailable();
    }
  }
  return {read,list(){
    let names:string[];
    try{if(lstatSync(root).isSymbolicLink())throw unavailable();names=readdirSync(root,{withFileTypes:true}).filter(entry=>(entry.isDirectory()||entry.isSymbolicLink())&&validId.test(entry.name)).map(entry=>entry.name).sort();}catch{throw unavailable();}
    const skills:GenerationSkillView[]=names.map(id=>{const {content,...view}=read(id);return view;});
    read(DEFAULT_GENERATION_SKILL);
    return {defaultSkillId:DEFAULT_GENERATION_SKILL,skills};
  }};
}
export const generationSkills=createGenerationSkills();
