import {createAdaptivePoller} from "./session-memory-polling";
import {useSessionMemory} from "./use-session-memory";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../api/client";
import { botApi } from "../../../api/bot-client";
import type { BotLiveExecution } from "../../../domain/bot";
import type { ActivityEvent, ConversationMessage, Project, Session } from "../../../domain/models";

export function useProjectSession(project: Project | null, preferredSessionId?: string, memoryVisible=false) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [liveEntries, setLiveEntries] = useState<Array<{id:string;kind:"tool"|"text";activity?:ActivityEvent;text?:string}>>([]);
  const [streamingText, setStreamingText] = useState("");
  const [pendingText, setPendingText] = useState("");
  const [compacting,setCompacting]=useState(false);
  const [running, setRunning] = useState(false);
  const [canStop,setCanStop] = useState(false);
  const [stopping,setStopping] = useState(false);
  const [error, setError] = useState("");
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const loadVersion = useRef(0);
  const latestSessions=useRef(sessions);latestSessions.current=sessions;
  const botTargetPending=useRef(false),pendingBotMessageId=useRef<string|null>(null),latestBotLive=useRef<BotLiveExecution|null>(null);
  const memory=useSessionMemory(project?.id??null,sessionId,memoryVisible,running);
  useEffect(()=>{
    const parent=project&&sessionId? sessions.find(s=>s.id===sessionId)?.botParent:null;
    if(!project||!sessionId||!parent)return;
    const live=new Map<string,BotLiveExecution>();
    const updateLive=()=>{
      const current=[...live.values()].find(execution=>execution.targetSessionId===sessionId)??null;
      latestBotLive.current=current;
      if(current)setRunning(true);
      else if(!botTargetPending.current){setStreamingText("");setActivities([]);setLiveEntries([]);}
    };
    const loop=createAdaptivePoller({request:async()=>{
      const [nextSessions,nextMessages,detail]=await Promise.all([api.listSessions(project.id),api.listMessages(project.id,sessionId),botApi.detail(parent.botId,parent.conversationId)]);
      return {sessions:nextSessions,messages:nextMessages,detail};
    },receive:v=>{
      setSessions(v.sessions);setMessages(v.messages);
      const targetExecutions=v.detail.executions.filter(execution=>execution.targetSessionId===sessionId&&['queued','running','unknown'].includes(execution.status)),
        target=v.sessions.find(item=>item.id===sessionId),active=targetExecutions.length>0||!!latestBotLive.current||!!(target&&['running','starting','interrupting'].includes(target.state));
      botTargetPending.current=targetExecutions.length>0;
      setRunning(active);
      setCanStop(targetExecutions.some(execution=>execution.status==='queued'||execution.status==='running')||!!(target&&['running','starting','interrupting'].includes(target.state)));
      const message=pendingBotMessageId.current?v.detail.messages.find(item=>item.id===pendingBotMessageId.current):null;
      if(message?.deliveryStatus==='delivered'&&message.targetNativeEntryId&&v.messages.some(item=>item.id===message.targetNativeEntryId)){
        pendingBotMessageId.current=null;setPendingText("");
      }
      if(!targetExecutions.length&&!latestBotLive.current){setActivities([]);setStreamingText("");}
    },error:c=>setError(c instanceof Error?c.message:'无法读取协作会话'),delay:()=>{const s=latestSessions.current.find(s=>s.id===sessionId);return botTargetPending.current||latestBotLive.current||s&&['running','starting','interrupting'].includes(s.state)?2000:30000;},visible:()=>!document.hidden});
    const updateFromEvent=(event:import("../../../domain/bot").BotLiveEvent)=>{
      if(event.type==='snapshot'){
        live.clear();for(const execution of event.executions)if(execution.targetSessionId===sessionId)live.set(execution.executionId,execution);
        updateLive();
      }else if(event.type==='execution'){
        if(event.execution.targetSessionId===sessionId)live.set(event.execution.executionId,event.execution);
        updateLive();
      }else if(event.type==='delta'){
        setLiveEntries(current=>{const last=current.at(-1);return last?.kind==='text'?[...current.slice(0,-1),{...last,text:(last.text??'')+event.text}]:[...current,{id:`text-${current.length}`,kind:'text',text:event.text}];});
      }else if(event.type==='reset'){
        setLiveEntries(current=>current.at(-1)?.kind==='text'?current.slice(0,-1):current);
      }else if(event.type==='activity'){
        if(event.activity.kind!=='tool')return;setLiveEntries(current=>{const index=current.findIndex(item=>item.id===event.activity.id);return index<0?[...current,{id:event.activity.id,kind:'tool',activity:event.activity}]:current.map(item=>item.id===event.activity.id?{...item,activity:event.activity}:item);});
      }else if(event.type==='finished'){
        live.delete(event.executionId);updateLive();void loop.refresh();
      }
    };
    const unsubscribe=botApi.subscribeLive(parent.botId,parent.conversationId,updateFromEvent);
    void loop.refresh();const show=()=>{if(document.hidden)loop.pause();else void loop.refresh();};document.addEventListener('visibilitychange',show);
    return()=>{loop.dispose();unsubscribe();live.clear();latestBotLive.current=null;document.removeEventListener('visibilitychange',show);};
  },[project?.id,sessionId,!!sessions.find(s=>s.id===sessionId)?.botParent]);
  useEffect(()=>{if(!memory.view||!sessionId)return;const summary=memory.view.sessionMemory.contextJson.summary;setSessions(current=>current.map(item=>item.id===sessionId&&item.memorySummary!==summary?{...item,memorySummary:summary}:item));},[memory.view,sessionId]);

  const load = useCallback(async (nextProject: Project, preferredSessionId?: string | null) => {
    const version = ++loadVersion.current;
    setActivities([]);
    setLiveEntries([]);
    setStreamingText("");
    setPendingText("");
    const nextSessions = await api.listSessions(nextProject.id);
    const nextId = preferredSessionId && nextSessions.some((item) => item.id === preferredSessionId)
      ? preferredSessionId
      : nextSessions.at(-1)?.id ?? null;
    const nextMessages = nextId ? await api.listMessages(nextProject.id, nextId) : [];
    if (version !== loadVersion.current) return;
    setSessions(nextSessions);
    setSessionId(nextId);
    setCanStop(!!nextSessions.find(item=>item.id===nextId&&['running','starting','interrupting'].includes(item.state)));
    setMessages(nextMessages);
    setLoadedProjectId(nextProject.id);
  }, []);

  useEffect(() => {
    if (!project) {loadVersion.current++;setLoadedProjectId(null);return;}
    void load(project, preferredSessionId).catch((cause) => setError(cause instanceof Error ? cause.message : "无法加载项目会话"));
  }, [load, preferredSessionId, project]);

  useEffect(()=>{
    if(!project||!sessionId||!compacting)return;
    const loop=createAdaptivePoller({request:()=>api.getNativeContext(project.id,sessionId),receive:value=>setCompacting(value.compactionState==="running"),error:()=>{},delay:()=>2000,visible:()=>!document.hidden});
    void loop.refresh();const visible=()=>{if(document.hidden)loop.pause();else void loop.refresh();};document.addEventListener("visibilitychange",visible);
    return()=>{loop.dispose();document.removeEventListener("visibilitychange",visible);};
  },[project?.id,sessionId,compacting]);

  async function selectSession(nextId: string) {
    if (!project) return;
    botTargetPending.current=false;pendingBotMessageId.current=null;latestBotLive.current=null;
    setActivities([]);
    setLiveEntries([]);
    setStreamingText("");setPendingText("");setRunning(false);
    setSessionId(nextId);
    setMessages(await api.listMessages(project.id, nextId));
    const nextSessions=await api.listSessions(project.id);
    setSessions(nextSessions);
    setCanStop(!!nextSessions.find(item=>item.id===nextId&&['running','starting','interrupting'].includes(item.state)));
  }

  async function send(content: string,steer=false,references?: import("../../../../src/domain/message-references").MessageReference[]) {
    if (!project || running || compacting) return;
    let activeSessionId = sessionId;
    if(!activeSessionId)throw new Error('请先选择项目角色并创建会话');
    const activeSession=sessions.find(item=>item.id===activeSessionId);
    if(activeSession?.botParent){
      botTargetPending.current=true;setRunning(true);setCanStop(true);setPendingText(content);setStreamingText("");setActivities([]);setLiveEntries([]);setError("");
      try{
        const accepted=await botApi.send(activeSession.botParent.botId,activeSession.botParent.conversationId,content,activeSessionId,steer);
        pendingBotMessageId.current=accepted.id;
        const [nextSessions,nextMessages]=await Promise.all([api.listSessions(project.id),api.listMessages(project.id,activeSessionId)]);
        setSessions(nextSessions);setMessages(nextMessages);
      }catch(cause){
        botTargetPending.current=false;pendingBotMessageId.current=null;setRunning(false);setCanStop(false);setPendingText("");
        setError(cause instanceof Error?cause.message:'无法发送项目消息');throw cause;
      }
      return;
    }
    setRunning(true);setCanStop(true);
    setPendingText(content);
    setStreamingText("");
    setActivities([]);
    setLiveEntries([]);
    let accepted=false;
    try {
      for await (const event of api.sendMessage(project.id, activeSessionId, content,steer,()=>{accepted=true;},references)) {
        if (event.type === "message_delta") setLiveEntries(current => { const last = current.at(-1); return last?.kind === "text" ? [...current.slice(0, -1), { ...last, text: (last.text ?? "") + event.text }] : [...current, { id: `text-${current.length}`, kind: "text", text: event.text }]; });
        if (event.type === "response_reset") setLiveEntries(current => current.at(-1)?.kind === "text" ? current.slice(0, -1) : current);
        if (event.type === "activity" && event.kind === "tool") setLiveEntries(current => {
          const index = current.findIndex(item => item.id === event.id);
          return index < 0 ? [...current, { id: event.id, kind: "tool", activity: event }] : current.map(item => item.id === event.id ? { ...item, activity: event } : item);
        });
        if (event.type === "error") {
          setError(event.message);
          setActivities((current) => current.map((activity) => activity.state === "running" ? { ...activity, state: "error" } : activity));
        }
      }
      setMessages(await api.listMessages(project.id, activeSessionId));
      setSessions(await api.listSessions(project.id));
      setActivities([]);
      setLiveEntries([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法发送项目消息");
      setActivities((current) => current.map((activity) => activity.state === "running" ? { ...activity, state: "error" } : activity));
      if(!accepted) throw cause;
      try { setMessages(await api.listMessages(project.id, activeSessionId)); } catch { /* keep the displayed error */ }
    } finally {
      setRunning(false); setCanStop(false); setPendingText(""); setStreamingText("");
    }
  }

  async function interrupt() {
    if (!project || !sessionId) return;
    setStopping(true);
    try {
      const updated=await api.interruptProjectSession(project.id, sessionId);
      setSessions(current=>current.map(item=>item.id===updated.id?updated:item));
      setCanStop(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法停止项目工作线"); }
    finally {setStopping(false);}
  }
  async function restore() {
    if (!project || !sessionId) return;
    try {
      const restored = await api.restoreProjectSession(project.id, sessionId);
      setSessions((current) => current.map((item) => item.id === restored.id ? restored : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法恢复项目工作线"); }
  }
  async function end() {
    if (!project || !sessionId) return;
    try { await api.endProjectSession(project.id, sessionId); await load(project, null); } catch (cause) { setError(cause instanceof Error ? cause.message : "无法结束项目工作线"); }
  }

  return { sessions, sessionId, messages, activities, liveEntries, streamingText, pendingText, running, canStop, stopping, compacting, setCompacting, error, setError, loadedProjectId, memory, selectSession, send, interrupt, restore, end };
}
