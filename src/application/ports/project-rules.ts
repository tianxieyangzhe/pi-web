export type ProjectRuleIdentity={scope:'project';projectId:string}|{scope:'workspace';workspaceId:string;projectId:string};
export type ProjectRuleView={identity:ProjectRuleIdentity;revision:number;contentSha256:string|null;enabled:boolean;markdown:string;writeETag:string};
export interface ProjectRulesStore {read(identity:ProjectRuleIdentity):ProjectRuleView;write(identity:ProjectRuleIdentity,etag:string,change:{enabled:boolean}|{markdown:string}):ProjectRuleView;}
