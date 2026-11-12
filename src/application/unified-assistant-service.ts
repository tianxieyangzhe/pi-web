import {DomainError} from '@/domain/errors';
import {validateDefinition} from '@/domain/agent-definition';
import {isUnifiedAssistant,type UnifiedAssistantDefinition} from '@/domain/assistant-document';
import type {createAgentPreparationService} from './agent-service';
export function createUnifiedAssistantService(legacy:ReturnType<typeof createAgentPreparationService>,validateSource:(value:UnifiedAssistantDefinition['source'])=>void){
 return {skills:legacy.skills,skill:legacy.skill,async prepare(body:Record<string,unknown>,signal:AbortSignal){
  if(Object.keys(body).some(k=>!['mode','currentDraft','inputText','feedback','requirements','source'].includes(k))||!['generate','revise'].includes(String(body.mode))||!isUnifiedAssistant(body.currentDraft))throw new DomainError('INVALID_INPUT','请选择统一助手定义',400,true);
  const current=validateDefinition(body.currentDraft,'project',true) as UnifiedAssistantDefinition;if(current.source!==null)validateSource(current.source);
  const material=body.inputText??body.feedback??body.requirements;
  if(typeof material!=='string'||!material.trim())throw new DomainError('INVALID_INPUT','请输入系统提示词要求',400,true);
  const old={format:3,mode:'custom',scope:'project',source:null,systemPrompt:current.systemPrompt,projects:[]};
  const result=await legacy.prepare({mode:body.mode,currentDraft:old,...(body.mode==='generate'?{inputText:material,requirements:'依据输入润色为完整系统提示词'}:{feedback:material})},signal);
  const definition:UnifiedAssistantDefinition={...current,systemPromptMode:'replace',systemPrompt:result.definition.systemPrompt};validateDefinition(definition,'project');
  return {...result,definition,markdown:definition.systemPrompt};
 }};
}
