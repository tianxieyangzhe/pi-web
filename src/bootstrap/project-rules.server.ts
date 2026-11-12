import 'server-only';
import {createProjectRulesService} from '@/application/project-rules-service';
import {createAgentPreparationService} from '@/application/agent-service';
import {projectRulesStore} from '@/infrastructure/agents/project-rules-store.server';
import {createProjectRuleGenerationsStore} from '@/infrastructure/agents/project-rule-generations.server';
import {resolveAssistantSource} from '@/infrastructure/agents/assistant-sources.server';
import {generationSkills} from '@/infrastructure/agents/generation-skills.server';
import {generateAgentDefinition} from '@/infrastructure/pi/agent-generation.server';
const state=globalThis as typeof globalThis&{__projectRulesGenerationService?:ReturnType<typeof createProjectRulesService>};
export const projectRulesService=state.__projectRulesGenerationService??=createProjectRulesService({
 store:projectRulesStore,generations:createProjectRuleGenerationsStore(),
 resolve:id=>resolveAssistantSource(id.scope==='project'?{kind:'project',projectId:id.projectId}:{kind:'workspace',workspaceId:id.workspaceId,projectIds:[id.projectId]})[0],
 prepare:createAgentPreparationService({skills:generationSkills,resolveSource:resolveAssistantSource,generate:generateAgentDefinition})
});
