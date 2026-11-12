import type {ProjectRuleIdentity,ProjectRuleView} from './project-rules';
import type {AgentPreparationProgress} from '../agent-service';
export type ProjectRuleGenerationStatus='queued'|'running'|'cancelling'|'publishing'|'succeeded'|'failed'|'cancelled'|'interrupted';
export type ProjectRuleGeneration={
 id:string;status:ProjectRuleGenerationStatus;mode?:'generate'|'revise';requirements:string;skillId:string|null;
 createdAt:string;updatedAt:string;startedAt:string|null;completedAt:string|null;
 progress:AgentPreparationProgress|null;resultRevision:number|null;error:{code:string;message:string}|null;
};
export type StoredProjectRuleGeneration=ProjectRuleGeneration&{requestKey:string;baseETag:string;inputRevision:number;resultSha256:string|null};
export type ProjectRulesStatus=ProjectRuleView&{generation:ProjectRuleGeneration|null};
export interface ProjectRuleGenerationsStore {
 list(identity:ProjectRuleIdentity):StoredProjectRuleGeneration[];
 save(identity:ProjectRuleIdentity,task:StoredProjectRuleGeneration):void;
}
export const activeGeneration=(status:ProjectRuleGenerationStatus)=>['queued','running','cancelling','publishing'].includes(status);
