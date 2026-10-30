import { useCallback, useEffect, useRef, useState } from 'react';
import { botApi } from '../../../api/bot-client';
import { api } from '../../../api/client';
import type { BotDetail, BotLiveEvent, BotNativeMessage } from '../../../domain/bot';
import type { ActivityEvent, ConversationMessage } from '../../../domain/models';
import { createAdaptivePoller } from '../project-session/session-memory-polling';

export function useBotConversation(botId: string | null, conversationId: string | null) {
  const [detail, setDetail] = useState<BotDetail | null>(null),
    [messages, setMessages] = useState<BotNativeMessage[]>([]),
    [sessionMessages, setSessionMessages] = useState<Record<string,ConversationMessage[]>>({}),
    [sessionErrors, setSessionErrors] = useState<Record<string,string>>({}),
    [liveText,setLiveText]=useState(''),
    [liveActivities,setLiveActivities]=useState<ActivityEvent[]>([]),
    [liveEntries,setLiveEntries]=useState<Array<{id:string;kind:'tool'|'text';activity?:ActivityEvent;text?:string}>>([]),
    [pendingText,setPendingText]=useState(''),
    [running,setRunning]=useState(false),
    [actionErrors,setActionErrors]=useState<Record<string,string>>({}),
    [error, setError] = useState('');
  const current = useRef<BotDetail | null>(null),
    runningCurrent=useRef(false),
    pendingRef=useRef(''),
    pendingBaseline=useRef(0),
    poller = useRef<ReturnType<typeof createAdaptivePoller<{
      detail: BotDetail;
      messages: BotNativeMessage[];
      sessionMessages:Record<string,ConversationMessage[]>;
      sessionErrors:Record<string,string>;
    }>> | null>(null);
  useEffect(() => {
    setDetail(null);
    setMessages([]);
    setSessionMessages({});
    setSessionErrors({});
    setLiveText('');
    setLiveActivities([]);
    setLiveEntries([]);
    setPendingText('');
    setRunning(false);
    setActionErrors({});
    setError('');
    current.current = null;
    if (!botId || !conversationId) return;
    const loop = createAdaptivePoller({
      request: async () => {
        const [detail, messages] = await Promise.all([botApi.detail(botId, conversationId), botApi.messages(botId, conversationId)]);
        return {detail,messages,sessionMessages:{},sessionErrors:{}};
      },
      receive: v => {
        current.current = v.detail;
        setDetail(v.detail);
        setMessages(v.messages);
        const users=v.messages.filter(message=>message.role==='user');
        if(pendingRef.current&&users.length>pendingBaseline.current&&users.at(-1)?.content.trim()===pendingRef.current.trim()){pendingRef.current='';setPendingText('');}
        setSessionMessages(v.sessionMessages);
        setSessionErrors(v.sessionErrors);
        setError('');
      },
      error: c => setError(c instanceof Error ? c.message : '无法读取 Bot 对话'),
      delay: () => runningCurrent.current ? 2000 : 30000,
      visible: () => !document.hidden
    });
    poller.current = loop;
    void loop.refresh();
    const receiveLiveEvent=(event:BotLiveEvent)=>{
      if(event.type!=='event'){if(event.type==='error'){runningCurrent.current=false;setRunning(false);setPendingText('');setActionErrors(current=>({...current,coordinator:event.message}));}if(event.type==='project_call'||event.type==='error')void loop.refresh();return;}
      const activity=event.event;
      if(activity.type==='message_delta'){runningCurrent.current=true;setRunning(true);setLiveEntries(current=>{const last=current.at(-1);return last?.kind==='text'?[...current.slice(0,-1),{...last,text:(last.text??'')+activity.text}]:[...current,{id:`text-${current.length}`,kind:'text',text:activity.text}];});}
      else if(activity.type==='response_reset')setLiveEntries(current=>current.at(-1)?.kind==='text'?current.slice(0,-1):current);
      else if(activity.type==='activity'&&activity.kind==='tool'){runningCurrent.current=true;setRunning(true);setLiveEntries(current=>{const index=current.findIndex(item=>item.id===activity.id);return index<0?[...current,{id:activity.id,kind:'tool',activity}]:current.map(item=>item.id===activity.id?{...item,activity}:item);});}
      else if(activity.type==='complete'||activity.type==='error'){runningCurrent.current=false;setRunning(false);void loop.refresh().finally(()=>{setLiveText('');setLiveActivities([]);setLiveEntries([]);});}
    };
    let unsubscribeLive:(()=>void)|null=null;
    const connectLive=()=>{if(!unsubscribeLive&&!document.hidden)unsubscribeLive=botApi.subscribeLive(botId,conversationId,receiveLiveEvent);};
    const disconnectLive=()=>{unsubscribeLive?.();unsubscribeLive=null;};
    connectLive();
    const show = () => {
      if(document.hidden){loop.pause();disconnectLive();}
      else{void loop.refresh();connectLive();}
    };
    document.addEventListener('visibilitychange', show);
    return () => {
      loop.dispose();
      disconnectLive();
      document.removeEventListener('visibilitychange', show);
      if (poller.current === loop) poller.current = null;
    };
  }, [botId, conversationId]);
  const refresh = useCallback(() => poller.current?.refresh() ?? Promise.resolve(), []);
  async function act(fn: () => Promise<unknown>,targetSessionId?:string|null) {
    const scope=targetSessionId??'coordinator';
    try {
      setError('');
      setActionErrors(current=>{const next={...current};delete next[scope];return next;});
      await fn();
      await refresh();
    } catch (c) {
      setActionErrors(current=>({...current,[scope]:c instanceof Error?c.message:'Bot 操作失败'}));pendingRef.current='';setPendingText('');setRunning(false);throw c;
    }
  }
  const messageTarget=(messageId:string)=>current.current?.messages.find(message=>message.id===messageId)?.targetSessionId,
    executionTarget=(executionId:string)=>current.current?.executions.find(execution=>execution.id===executionId)?.targetSessionId,
    taskTarget=(taskId:string)=>current.current?.tasks.find(task=>task.id===taskId)?.targetSessionId;
  return {
    detail,
    messages,
    sessionMessages,
    sessionErrors,
    actionErrors,
    liveText,
    liveActivities,
    liveEntries,
    pendingText,
    running,
    error,
    setError,
    clearActionError: (scope = "coordinator") => setActionErrors(current => { const next = { ...current }; delete next[scope]; return next; }),
    refresh,
    send: (text: string,targetSessionId?:string,references?: import("../../../../src/domain/message-references").MessageReference[]) => {
      if (!botId || !conversationId) return Promise.resolve();
      pendingRef.current=text;pendingBaseline.current=messages.filter(message=>message.role==='user').length;setPendingText(text);setRunning(true);runningCurrent.current=true;setError('');
      const scope=targetSessionId??'coordinator';
      setActionErrors(current=>{const next={...current};delete next[scope];return next;});
      return botApi.send(botId,conversationId,text,targetSessionId,false,references).then(()=>{void refresh();}).catch(c=>{
        setActionErrors(current=>({...current,[scope]:c instanceof Error?c.message:'Bot 操作失败'}));
        pendingRef.current='';setPendingText('');setRunning(false);runningCurrent.current=false;throw c;
      });
    },
    control: (action: string,executionId?:string,messageId?:string) => botId && conversationId ? act(() => botApi.control(botId, conversationId, action,executionId,messageId),executionId?executionTarget(executionId):messageId?messageTarget(messageId):null) : Promise.resolve(),
    cancelMessage:(messageId:string)=>botId&&conversationId?act(()=>botApi.cancelQueuedMessage(botId,conversationId,messageId),messageTarget(messageId)):Promise.resolve(),
    withdrawMessage:(messageId:string)=>botId&&conversationId?act(()=>botApi.withdrawUnknownMessage(botId,conversationId,messageId),messageTarget(messageId)):Promise.resolve(),
    stopWork:(workId:string)=>botId&&conversationId?act(()=>botApi.stopWork(botId,conversationId,workId),null):Promise.resolve(),
    interruptSession:(sessionId:string)=>{const participant=current.current?.participants.find(item=>item.id===sessionId);return participant?act(()=>api.interruptProjectSession(participant.projectId,sessionId),sessionId):Promise.reject(new Error('找不到此项目 Session'));},
    cancelExecution:(executionId:string)=>botId&&conversationId?act(()=>botApi.cancelQueued(botId,conversationId,executionId),executionTarget(executionId)):Promise.resolve(),
    retryTask:(taskId:string)=>botId&&conversationId?act(()=>botApi.retry(botId,conversationId,taskId),taskTarget(taskId)):Promise.resolve(),
    retryReceivedMessage:(messageId:string)=>botId&&conversationId?act(()=>botApi.retryReceived(botId,conversationId,messageId),messageTarget(messageId)):Promise.resolve(),
    retryPreflightMessage:(messageId:string)=>botId&&conversationId?act(()=>botApi.retryPreflight(botId,conversationId,messageId),messageTarget(messageId)):Promise.resolve(),
    act
  };
}
