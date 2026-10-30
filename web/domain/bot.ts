import type { Session, ConversationMessage, AgentSnapshot, RoleState, ActivityEvent } from "./models";
export type BotProjectAgentBinding={agentId:string;revision:number;kind:"project";botId:null;projectId:null;contentSha256:string;name:string;description:string|null};
export type BotProjectBinding={projectId:string;agents:BotProjectAgentBinding[]};
export type Bot = {
  id: string;
  name: string;
  description: string | null;
  workingDirectory: string;
  workspaceKind: 'managed' | 'user_selected';
  coordinatorAgentId:string|null;coordinatorAgentSnapshot:AgentSnapshot|null;
  projectBindings?:BotProjectBinding[];
  maxParallelExecutions: number;
  status: 'active' | 'disabled' | 'archived';
  writeETag: string;
};
export type BotConversation = {
  roleState?:RoleState;
  id: string;
  botId: string;
  title: string;
  goal: string;
  agentId:string|null;agentSnapshot:AgentSnapshot|null;
  projectBindings?:BotProjectBinding[];
  status:'open'|'archived';
  schedulingMode:'enabled'|'paused';
  createdAt: string;
  writeETag: string;
};
export type BotConversationStats = {
  projectCount: number;
  projectAgentCandidateCount: number;
  projectSessionCount: number;
  taskCount: number;
  completedTaskCount: number;
  activeTaskCount: number;
};
export type BotDisplayPhase='idle'|'coordinating'|'executing'|'awaiting_results'|'summarizing'|'waiting'|'needs_attention';
export type BotBlockingReason={code:string;entityType:'conversation'|'work'|'task'|'execution'|'message'|'session';entityId:string;reason:string};
export type BotAllowedAction={action:string;entityType:'conversation'|'work'|'task'|'execution'|'message'|'session';entityId:string};
export type BotLiveExecution = {
  executionId: string;
  conversationId: string;
  workId: string | null;
  taskId: string | null;
  targetSessionId: string | null;
  projectId: string | null;
  projectName: string | null;
  agentId: string;
  agentName: string;
  agentKind: 'coordinator' | 'project';
  state: 'starting' | 'running';
  text: string;
  activities: ActivityEvent[];
  startedAt: string;
};
export type BotLiveEvent =
  | { type: 'snapshot'; executions: BotLiveExecution[] }
  | { type: 'execution'; execution: BotLiveExecution }
  | { type: 'delta'; executionId: string; text: string }
  | { type: 'reset'; executionId: string }
  | { type: 'activity'; executionId: string; activity: ActivityEvent }
  | { type: 'finished'; executionId: string; state: 'completed' | 'failed' | 'cancelled' | 'unknown' }
  | { type: 'event'; event: import('./models').AgentEvent }
  | { type: 'project_call'; callId: string; progress: 'not_started' | 'processing' | 'finished' }
  | { type: 'error'; code: string; message: string };
export type BotParticipant = {
  roleState?:RoleState;agentId?:string|null;agentSnapshot?:AgentSnapshot|null;participantName?:string|null;
  writeETag:string;
  id: string;
  botConversationId: string;
  roleName: string;
  topic?: string;
  assignment: string|null;
  collaborationState: 'active' | 'disabled';
  projectId: string;
  projectName?: string;
  memorySummary?: string;
  state?: Session['state'];
};
export type BotTask = {
  id: string;
  conversationId: string;
  workId:string;
  targetSessionId: string;
  title: string;
  instruction: string;
  acceptanceCriteria: string[];
  operation: 'read' | 'project_write';
  status:'open'|'completed'|'failed'|'cancelled';
  waitingForMessageId:string|null;
  creationReason:string|null;
  finishedAt:string|null;
};
export type BotExecution = {
  id: string;
  conversationId:string;
  workId:string|null;
  triggerMessageId:string|null;
  targetSessionId: string | null;
  taskId: string | null;
  status:'queued'|'running'|'completed'|'failed'|'cancelled'|'unknown';
  inputMode:'append'|'resume_received';
  resumedFromExecutionId:string|null;
  cancelRequestedAt:string|null;
  inputNativeEntryId:string|null;
  errorCode?:string|null;
  errorMessage: string | null;
  agentSnapshot?:AgentSnapshot|null;
  resultJson: {
    summary: string;
    verification: string;
    blockers: string[];
    workOutcome?:'completed'|'failed';
    agentDefinitionIssue?:{summary:string;evidenceEntryIds:string[]};
  } | null;
};
export type BotMessage = {
  id: string;
  conversationId:string;
  workId:string|null;
  taskId:string|null;
  sourceKind:'user'|'coordinator'|'project_session'|'service';
  sourceSessionId: string | null;
  targetSessionId: string | null;
  kind: string;
  deliveryStatus:'pending'|'delivering'|'delivered'|'unknown'|'cancelled';
  deliveryMode:'when_idle'|'steer';
  targetNativeEntryId:string|null;
  withdrawRequestedAt:string|null;
  content: string;
  replyToMessageId: string | null;
};
export type BotWork={id:string;conversationId:string;originMessageId:string;title:string;goal:string;status:'open'|'completed'|'failed'|'cancelled';finalExecutionId:string|null;createdAt:string;updatedAt:string;finishedAt:string|null};
export type BotOverview = {
  available: boolean;
  bots: Bot[];
  conversations: BotConversation[];
  participants: BotParticipant[];
};
export type BotProjectCall={id:string;projectId:string;sessionId:string|null;sourceEntryId:string;status:'accepted'|'working'|'completed'|'aborted'|'unknown';output:string|null;outputError:string|null;createdAt:string};
export type BotDetail = {
  bot: Bot;
  conversation: BotConversation;
  participants: BotParticipant[];
  calls?:BotProjectCall[];
  works:BotWork[];
  tasks: BotTask[];
  executions: BotExecution[];
  messages: BotMessage[];
  dependencies: Array<{
    taskId: string;
    dependsOnTaskId: string;
  }>;
  busy: boolean;
  displayPhase:BotDisplayPhase;
  coordinationPending:boolean;
  blockingReasons:BotBlockingReason[];
  allowedActions:BotAllowedAction[];
  canAcceptUserMessage:boolean;
  canRunCoordinator:boolean;
  canDispatchProjectTask:boolean;
  sessionCapabilities:Array<{sessionId:string;canRunSession:boolean;canAdoptAgentVersion:boolean}>;
  canRetryTaskIds:string[];
  canResumeReceivedMessageIds:string[];
  canRetryPreflightMessageIds:string[];
  canAdoptAgentVersion:boolean;
  nextCursors: {
    tasks: string | null;
    works:string|null;
    executions: string | null;
    messages: string | null;
  };
  stats: BotConversationStats;
};
export type BotNativeMessage = Omit<ConversationMessage, 'sessionId'> & {executionId?:string|null};
