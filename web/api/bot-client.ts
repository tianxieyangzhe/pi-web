import type { Bot, BotConversation, BotParticipant, BotDetail, BotOverview, BotMessage } from '../domain/bot';
import type { NativeContextInspection } from '../domain/native-context';
import type { FilePreview, ProjectFileListing } from '../domain/models';
async function request<T>(url: string, method = 'GET', body?: unknown, etag?: string) {
  const res = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(method === 'POST' ? {
        'idempotency-key': crypto.randomUUID()
      } : {}),
      ...(etag ? {
        'if-match': etag
      } : {})
    },
    ...(body === undefined ? {} : {
      body: JSON.stringify(body)
    })
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error?.message ?? 'Bot 请求失败');
  return payload.data as T;
}
const base = (b: string, c: string) => `/api/bots/${b}/conversations/${c}`;
export const botApi = {
  list: () => request<BotOverview>('/api/bots'),
  create: (body: Record<string, unknown>) => request<Bot>('/api/bots', 'POST', body),
  update: (b: Bot, body: Record<string, unknown>) => request<Bot>(`/api/bots/${b.id}`, 'PATCH', body, b.writeETag),
  createConversation: (b: string, body: Record<string, unknown>) => request<BotConversation>(`/api/bots/${b}/conversations`, 'POST', body),
  detail: (b: string, c: string, before?: {
    tasks?: string;
    works?:string;
    executions?: string;
    messages?: string;
  }) => request<BotDetail>(base(b, c) + (before ? '?' + new URLSearchParams(Object.entries(before).filter(([,v])=>typeof v==='string').map(([k, v]) => [k + 'Before', v!])).toString() : '')),
  updateConversation:(b:string,c:BotConversation,body:Record<string,unknown>)=>request<BotConversation>(base(b,c.id),"PATCH",body,c.writeETag),
  cancelQueuedMessage:(b:string,c:string,id:string)=>request<BotDetail>(base(b,c)+'/messages/'+id+'/cancel','POST'),
  withdrawUnknownMessage:(b:string,c:string,id:string)=>request<BotDetail>(base(b,c)+'/messages/'+id+'/withdraw','POST'),
  cancelQueued:(b:string,c:string,executionId:string)=>request<BotDetail>(base(b,c)+'/executions/'+executionId+'/cancel','POST'),
  stopWork:(b:string,c:string,workId:string)=>request<BotDetail>(base(b,c)+'/works/'+workId+'/stop','POST'),
  configureRole:(b:string,c:BotConversation,agentId:string,revision?:number,contentSha256?:string)=>request<BotDetail>(base(b,c.id)+"/role","POST",{agentId,revision,contentSha256},c.writeETag),
  messages: (b: string, c: string) => request<import("../domain/models").SessionTree>(base(b, c) + '/messages'),
  send: (b: string, c: string, content: string, targetSessionId?: string, steer = false, references?: import("../../src/domain/message-references").MessageReference[]) => request<BotMessage>(base(b, c) + '/messages', 'POST', {
    content,
    targetSessionId,
    steer,
    references
  }),
  attach: (b: string, c: string, body: Record<string, unknown>) => request<BotParticipant>(base(b, c) + '/sessions', 'POST', body),
  updateParticipant: (b: string, c: string, id: string, body: Record<string, unknown>,etag:string) => request<BotParticipant>(base(b, c) + '/sessions/' + id, 'PATCH', body,etag),
  control: (b: string, c: string, action: string, executionId?: string, messageId?:string) => request<BotDetail>(base(b, c) + '/control', 'POST', {
    action,
    executionId,
    messageId
  }),
  retry: (b: string, c: string, taskId: string) => request(base(b, c) + '/tasks/' + taskId + '/retry', 'POST'),
  retryReceived:(b:string,c:string,messageId:string)=>request(base(b,c)+'/control','POST',{action:'resume_received',messageId}),
  retryPreflight:(b:string,c:string,messageId:string)=>request(base(b,c)+'/control','POST',{action:'retry_preflight',messageId}),
  inspect: (b: string, c: string) => request<NativeContextInspection>(base(b, c) + '/context'),
  compact: (b: string, c: string) => request<NativeContextInspection>(base(b, c) + '/compact', 'POST'),
  cancelCompact: (b: string, c: string) => request<NativeContextInspection>(base(b, c) + '/compact/cancel', 'POST'),
  files: (b: string, c: string, path = '') => request<ProjectFileListing>(base(b, c) + '/files?path=' + encodeURIComponent(path)),
  referenceFiles: (b: string, c: string, path = '') => request<ProjectFileListing>(base(b, c) + '/files?purpose=references&path=' + encodeURIComponent(path)),
  read: (b: string, c: string, path: string) => request<FilePreview>(base(b, c) + '/files/content?path=' + encodeURIComponent(path))
};
