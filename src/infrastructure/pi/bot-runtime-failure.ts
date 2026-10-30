import { DomainError } from '@/domain/errors';

export function botModelFailure(errorMessage: unknown): DomainError {
  const raw = typeof errorMessage === 'string' ? errorMessage : '';
  if (/model_not_found|No available channel for model/i.test(raw)) {
    return new DomainError('BOT_MODEL_UNAVAILABLE', '配置的模型没有可用渠道，请检查 .env.local 的 OPENAI_MODEL_ID 或恢复模型服务。', 503, true);
  }
  if (/\b401\b|invalid_api_key|authentication_error/i.test(raw)) {
    return new DomainError('BOT_MODEL_AUTH_FAILED', '模型服务认证失败，请检查 .env.local 的 API Key。', 503, true);
  }
  return new DomainError('BOT_RUNTIME_FAILED', 'Pi 模型调用失败，请检查模型服务。', 503, true);
}

export function botMessageEntries(entries: readonly {id: string; type: string; customType?: string; data?: unknown; details?: unknown; message?: unknown}[], startId: string | null) {
  const from = startId ? entries.findIndex(entry => entry.id === startId) : -1;
  if (startId && from < 0) return {};
  const result: Record<string, string> = {};
  for (const entry of entries.slice(from + 1)) {
    if (entry.type === 'custom' && entry.customType === 'bot_input_link') {
      const data = entry.data as {messageId?: unknown; inputNativeEntryId?: unknown} | undefined;
      if (typeof data?.messageId === 'string' && typeof data.inputNativeEntryId === 'string') result[data.messageId] = data.inputNativeEntryId;
      continue;
    }
    if (entry.type === 'custom_message' && entry.customType === 'bot_input') {
      const messageId = (entry.details as {messageId?: unknown} | undefined)?.messageId;
      if (typeof messageId === 'string') result[messageId] = entry.id;
      continue;
    }
    if (entry.type !== 'message') continue;
    const message = entry.message as {role?: string; content?: unknown} | undefined;
    if (message?.role !== 'user') continue;
    const content = typeof message.content === 'string' ? message.content : Array.isArray(message.content)
      ? message.content.map(part => part?.type === 'text' ? part.text : '').join('') : '';
    for (const match of content.matchAll(/\[BOT_MESSAGE:([^\]]+)\]/g)) result[match[1]] = entry.id;
  }
  return result;
}

type ResumeTranscriptEntry={id:string;type:string;customType?:string;data?:unknown;details?:unknown;message?:unknown};
function text(value:unknown){return typeof value==='string'?value:Array.isArray(value)?value.map(part=>part?.type==='text'?part.text:'').join(''):'';}
export function assertSafeReceivedTranscript(entries:readonly ResumeTranscriptEntry[],priorExecutionId:string,messageId:string,inputEntryId:string){
  const priorStart=entries.find(entry=>entry.type==='custom'&&entry.customType==='bot_execution_start'&&(entry.data as {executionId?:string}|undefined)?.executionId===priorExecutionId);
  if(!priorStart)throw new DomainError('RESUME_UNSUPPORTED','原执行的 Pi 起始边界不可核验，不能安全续答',409,true);
  if(entries.some(entry=>entry.type==='custom'&&entry.customType==='bot_execution_end'&&(entry.data as {executionId?:string}|undefined)?.executionId===priorExecutionId))throw new DomainError('RESUME_UNSUPPORTED','原执行已有结束边界，应另发新消息而不是续答',409,true);
  const metadata=priorStart.data as {startId?:string|null;inputMode?:string;triggerMessageId?:string|null;inputNativeEntryId?:string|null},
    startId=metadata.startId??null,startIndex=startId?entries.findIndex(entry=>entry.id===startId):-1,
    inputIndex=entries.findIndex(entry=>{if(entry.type==='custom_message'&&entry.customType==='bot_input')return (entry.details as {messageId?:unknown}|undefined)?.messageId===messageId;if(entry.type!=='message')return false;const value=entry.message as {role?:string;content?:unknown};return value.role==='user'&&text(value.content).includes(`[BOT_MESSAGE:${messageId}]`);});
  const resumed=metadata.inputMode==='resume_received',inputInCorrectRange=resumed?inputIndex>=0&&inputIndex<=startIndex:inputIndex>startIndex;
  if(inputIndex<0||entries[inputIndex]?.id!==inputEntryId||startId&&startIndex<0||!inputInCorrectRange||resumed&&(metadata.triggerMessageId!==messageId||metadata.inputNativeEntryId!==inputEntryId))throw new DomainError('RESUME_UNSUPPORTED','原用户输入标记与执行边界不匹配，不能安全续答',409,true);
  for(const entry of entries.slice(inputIndex+1))if(entry.type==='message'&&(entry.message as {role?:string}).role==='user')throw new DomainError('RESUME_UNSUPPORTED','此后已有其他用户输入；请在总对话中明确继续，不会重放较早消息',409,true);
  for(const entry of entries.slice(startIndex+1))if(entry.type==='message'){
    const message=entry.message as {role?:string;content?:unknown},parts=Array.isArray(message.content)?message.content:[];
    if(message.role==='assistant'&&parts.some(part=>part?.type==='toolCall'))throw new DomainError('RESUME_UNSUPPORTED','原执行已经开始调用工具；为避免重复操作，不能自动续答',409,true);
  }
}
