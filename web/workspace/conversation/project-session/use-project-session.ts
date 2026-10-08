import {createAdaptivePoller} from "./session-memory-polling";
import {useSessionMemory} from "./use-session-memory";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../api/client";
import type { ActivityEvent, ConversationMessage, Project, Session } from "../../../domain/models";

export function useProjectSession(project: Project | null, preferredSessionId?: string, memoryVisible=false) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [pendingText, setPendingText] = useState("");
  const [compacting,setCompacting]=useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const loadVersion = useRef(0);
  const memory=useSessionMemory(project?.id??null,sessionId,memoryVisible,running);
  useEffect(()=>{if(!memory.view||!sessionId)return;const summary=memory.view.sessionMemory.contextJson.summary;setSessions(current=>current.map(item=>item.id===sessionId&&item.memorySummary!==summary?{...item,memorySummary:summary}:item));},[memory.view,sessionId]);

  const load = useCallback(async (nextProject: Project, preferredSessionId?: string | null) => {
    const version = ++loadVersion.current;
    setActivities([]);
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
    setMessages(nextMessages);
    setLoadedProjectId(nextProject.id);
  }, []);

  useEffect(() => {
    if (!project) return;
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
    setActivities([]);
    setSessionId(nextId);
    setMessages(await api.listMessages(project.id, nextId));
  }

  async function send(content: string) {
    if (!project || running || compacting) return;
    let activeSessionId = sessionId;
    if (!activeSessionId) {
      const created = await api.createSession(project.id);
      activeSessionId = created.id;
      setSessions((current) => [...current, created]);
      setSessionId(created.id);
    }
    setRunning(true);
    setPendingText(content);
    setStreamingText("");
    setActivities([]);
    try {
      for await (const event of api.sendMessage(project.id, activeSessionId, content)) {
        if (event.type === "message_delta") setStreamingText((current) => current + event.text);
        if (event.type === "response_reset") setStreamingText("");
        if (event.type === "activity") setActivities((current) => {
          const index = current.findIndex((item) => item.id === event.id);
          if (index < 0) return [...current, event];
          const next = [...current]; next[index] = event; return next;
        });
        if (event.type === "error") {
          setError(event.message);
          setActivities((current) => current.map((activity) => activity.state === "running" ? { ...activity, state: "error" } : activity));
        }
      }
      setMessages(await api.listMessages(project.id, activeSessionId));
      setActivities([]);
      setSessions(await api.listSessions(project.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法发送项目消息");
      setActivities((current) => current.map((activity) => activity.state === "running" ? { ...activity, state: "error" } : activity));
    } finally {
      setRunning(false); setPendingText(""); setStreamingText("");
    }
  }

  async function interrupt() {
    if (!project || !sessionId) return;
    try { await api.interruptProjectSession(project.id, sessionId); } catch (cause) { setError(cause instanceof Error ? cause.message : "无法停止项目工作线"); }
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

  return { sessions, sessionId, messages, activities, streamingText, pendingText, running, compacting, setCompacting, error, setError, loadedProjectId, memory, selectSession, send, interrupt, restore, end };
}
