export type SessionMemoryOutput={title:string;summary:string;path:string|null};
export type SessionMemoryContext={summary:string;goal:string;constraints:string[];facts:string[];decisions:string[];nextActions:string[];outputs:SessionMemoryOutput[]};
export type SessionMemoryDraft={id:string;context:SessionMemoryContext;baseContextHash:string;source:"template"|"rule"|"llm";sourceAfterEntryId:string|null;sourceThroughEntryId:string|null;inputTokens:number|null;outputTokens:number|null;generatedAt:string};
export type SessionMemory={id:string;projectId:string|null;sourceTemplateId:string|null;title:string;contextJson:SessionMemoryContext;draftJson:SessionMemoryDraft|null;lastReviewedEntryId:string|null;createdAt:string;updatedAt:string};
export type SessionMemoryView={availableRanges:Array<{after:string|null;through:string;label:string}>;sessionMemory:SessionMemory;writeETag:string;generationState:"idle"|"queued"|"generating"|"failed";syncState:"synced"|"updating"|"pending"|"failed"|"unavailable";memoryUpdatedAt:string;error:string|null;lastOutcome:string;completedAnswerCount:number;pendingAnswerCount:number;hasUnreviewedMessages:boolean;canWrite:boolean;canSummarize:boolean;sourceRange:{through:string;count:number}|null};

export const blankContext=():SessionMemoryContext=>({summary:"",goal:"",constraints:[],facts:[],decisions:[],nextActions:[],outputs:[]});
