export type SessionOpenIdentity={scope:'project'|'workspace';ownerId:string;sessionId:string};
export interface SessionOpenHistory {
 get(identity:SessionOpenIdentity):string|null;
 record(identity:SessionOpenIdentity):void;
}
