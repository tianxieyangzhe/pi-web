import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../api/client";
import type { ConversationMessage, Project, Session } from "../../../domain/models";
import { useSessionTree } from "../use-session-tree";

export function useProjectSession(project: Project | null, preferredSessionId?: string) {
  const [sessions, setSessions] = useState<Session[]>([]), [sessionId, setSessionId] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false), [_, setCompacting] = useState(false);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const loadVersion = useRef(0);
  const base = project && sessionId ? `/api/projects/${project.id}/sessions/${sessionId}` : null;
  const state = useSessionTree(base, () => api.listMessages(project!.id, sessionId!), async () => {
    const result = await api.listSessions(project!.id); if (selected.current === base) setSessions(result);
  });
  const selected = useRef(base); selected.current = base;
  const load = useCallback(async (nextProject: Project, preferred?: string | null) => {
    const version = ++loadVersion.current, nextSessions = await api.listSessions(nextProject.id);
    if (version !== loadVersion.current) return;
    setSessions(nextSessions); setSessionId(preferred && nextSessions.some(item => item.id === preferred) ? preferred : null); setLoadedProjectId(nextProject.id);
  }, []);
  useEffect(() => {
    if (!project) { loadVersion.current++; setLoadedProjectId(null); setSessionId(null); return; }
    void load(project, preferredSessionId).catch(cause => state.setError(cause instanceof Error ? cause.message : "无法加载项目会话"));
  }, [load, preferredSessionId, project]);
  const compacting=state.compacting;
  async function send(content: string, _steer = false, references?: import("../../../../src/domain/message-references").MessageReference[], webSearch?: boolean, toolSearch?: boolean) {
    if (!state.ready || compacting || stopping) throw new Error("会话尚未就绪、正在压缩或停止");
    try { await state.send(content, references, webSearch, toolSearch); } catch (cause) { state.setError(cause instanceof Error ? cause.message : "无法发送项目消息"); throw cause; }
  }
  async function interrupt() {
    if (!project || !sessionId) return; const target = base; setStopping(true);
    try { const updated = await api.interruptProjectSession(project.id, sessionId); if (selected.current === target) setSessions(current => current.map(item => item.id === updated.id ? updated : item)); }
    catch (cause) { if (selected.current === target) state.setError(cause instanceof Error ? cause.message : "无法停止项目会话"); } finally { if (selected.current === target) setStopping(false); }
  }
  async function restore() { if (!project || !sessionId) return; try { await api.restoreProjectSession(project.id, sessionId); state.retryOpen(); } catch (cause) { state.setError(cause instanceof Error ? cause.message : "无法恢复项目会话"); } }
  async function end() { if (!project || !sessionId) return; try { state.close();await api.endProjectSession(project.id, sessionId);await state.refresh(); } catch (cause) { state.setError(cause instanceof Error ? cause.message : "无法关闭会话"); } }
  const messages: ConversationMessage[] = state.tree.entries.flatMap(({ entry }) => (entry.message as { role?: string } | undefined)?.role === "user" ? [{ id: entry.id, sessionId: sessionId ?? "", role: "user" as const, content: "", createdAt: entry.timestamp }] : []);
  const removeDeletedSession = (id: string) => { loadVersion.current++; setSessions(current => current.filter(item => item.id !== id)); setSessionId(current => current === id ? null : current); };
  return { ...state, removeDeletedSession, sessions, sessionId, messages, activities: [], liveEntries: [], streamingText: "", canStop: state.running, stopping, compacting, setCompacting, loadedProjectId, reload: async () => { if(project)await load(project,sessionId); }, selectSession: async (id: string) => { setSessionId(id); setStopping(false); setCompacting(false); }, send, interrupt, restore, end };
}
