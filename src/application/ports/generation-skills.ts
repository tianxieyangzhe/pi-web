export const DEFAULT_GENERATION_SKILL = 'create-agentsmd';
export type GenerationSkillView = {id:string;name:string;description:string;sha256:string};
export type GenerationSkill = GenerationSkillView & {content:string};
export interface GenerationSkills {
  list(): {defaultSkillId:string;skills:GenerationSkillView[]};
  read(id:string): GenerationSkill;
}
