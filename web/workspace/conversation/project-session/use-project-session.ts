import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../api/client";
import type { ConversationMessage, Project, Session } from "../../../domain/models";
import { useSessionTree } from "../use-session-tree";
import { createAdaptivePoller } from "./session-memory-polling";
import { useSessionMemory } from "./use-session-memory";

export function useProjectSession(project: Project | null, preferredSessionId?: string, memoryVisible = false) {
  const [sessions, setSessions] = useState<Session[]>([]), [sessionId, setSessionId] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false), [compacting, setCompacting] = useState(false);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const loadVersion = useRef(0);
  const base = project && sessionId ? `/api/projects/${project.id}/sessions/${sessionId}` : null;
  const state = useSessionTree(base, () => api.listMessages(project!.id, sessionId!), async () => {
    const result = await api.listSessions(project!.id); if (selected.current === base) setSessions(result);
  });
  const selected = useRef(base); selected.current = base;
  const memory = useSessionMemory(project?.id ?? null, sessionId, memoryVisible, state.running);
  const load = useCallback(async (nextProject: Project, preferred?: string | null) => {
    const version = ++loadVersion.current, nextSessions = await api.listSessions(nextProject.id);
    if (version !== loadVersion.current) return;
    setSessions(nextSessions); setSessionId(preferred && nextSessions.some(item => item.id === preferred) ? preferred : null); setLoadedProjectId(nextProject.id);
  }, []);
  useEffect(() => {
    if (!project) { loadVersion.current++; setLoadedProjectId(null); setSessionId(null); return; }
    void load(project, preferredSessionId).catch(cause => state.setError(cause instanceof Error ? cause.message : "无法加载项目会话"));
  }, [load, preferredSessionId, project]);
  useEffect(() => {
    if (!memory.view || !sessionId) return;
    const summary = memory.view.sessionMemory.contextJson.summary;
    setSessions(current => current.map(item => item.id === sessionId && item.memorySummary !== summary ? { ...item, memorySummary: summary } : item));
  }, [memory.view, sessionId]);
  useEffect(() => {
    if (!project || !sessionId || !compacting) return;
    const loop = createAdaptivePoller({ request: () => api.getNativeContext(project.id, sessionId), receive: value => setCompacting(value.compactionState === "running"), error: () => {}, delay: () => 2000, visible: () => !document.hidden });
    void loop.refresh(); const visible = () => { if (document.hidden) loop.pause(); else void loop.refresh(); }; document.addEventListener("visibilitychange", visible);
    return () => { loop.dispose(); document.removeEventListener("visibilitychange", visible); };
  }, [project?.id, sessionId, compacting]);
  async function send(content: string, _steer = false, references?: import("../../../../src/domain/message-references").MessageReference[]) {
    if (!state.ready || state.running || compacting) throw new Error("会话尚未就绪或正在运行");
    try { await state.send(content, references); } catch (cause) { state.setError(cause instanceof Error ? cause.message : "无法发送项目消息"); throw cause; }
  }
  async function interrupt() {
    if (!project || !sessionId) return; const target = base; setStopping(true);
    try { const updated = await api.interruptProjectSession(project.id, sessionId); if (selected.current === target) setSessions(current => current.map(item => item.id === updated.id ? updated : item)); }
    catch (cause) { if (selected.current === target) state.setError(cause instanceof Error ? cause.message : "无法停止项目会话"); } finally { if (selected.current === target) setStopping(false); }
  }
  async function restore() { if (!project || !sessionId) return; try { await api.restoreProjectSession(project.id, sessionId); state.retryOpen(); } catch (cause) { state.setError(cause instanceof Error ? cause.message : "无法恢复项目会话"); } }
  async function end() { if (!project || !sessionId) return; try { await api.endProjectSession(project.id, sessionId); await load(project, null); } catch (cause) { state.setError(cause instanceof Error ? cause.message : "无法结束项目会话"); } }
  const messages: ConversationMessage[] = state.tree.entries.flatMap(({ entry }) => (entry.message as { role?: string } | undefined)?.role === "user" ? [{ id: entry.id, sessionId: sessionId ?? "", role: "user" as const, content: "", createdAt: entry.timestamp }] : []);
  const removeDeletedSession = (id: string) => { loadVersion.current++; setSessions(current => current.filter(item => item.id !== id)); setSessionId(current => current === id ? null : current); };
  return { ...state, removeDeletedSession, sessions, sessionId, messages, activities: [], liveEntries: [], streamingText: "", canStop: state.running, stopping, compacting, setCompacting, loadedProjectId, memory, selectSession: async (id: string) => { setSessionId(id); setStopping(false); setCompacting(false); }, send, interrupt, restore, end };
}
