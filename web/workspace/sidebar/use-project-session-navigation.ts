import { subscribeApplicationResource } from '../../api/application-events';
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { Session } from "../../domain/models";

export function useProjectSessionNavigation() {
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(() => new Set());
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, Session[]>>({});
  const [loadingProjectIds, setLoadingProjectIds] = useState<Set<string>>(() => new Set());
  const [errorsByProject, setErrorsByProject] = useState<Record<string, string>>({});
  const loadedProjectIds = useRef(new Set<string>());
  const loadingRequests = useRef(new Set<string>());
  const requestVersions = useRef(new Map<string, number>());

  const loadProjectSessions = useCallback(async (projectId: string, force = false) => {
    if ((!force && loadedProjectIds.current.has(projectId)) || loadingRequests.current.has(projectId)) return;
    const requestVersion = (requestVersions.current.get(projectId) ?? 0) + 1;
    requestVersions.current.set(projectId, requestVersion);
    loadingRequests.current.add(projectId);
    setLoadingProjectIds((current) => new Set(current).add(projectId));
    setErrorsByProject((current) => {
      const next = { ...current };
      delete next[projectId];
      return next;
    });
    try {
      const sessions = await api.listSessions(projectId);
      if (requestVersions.current.get(projectId) !== requestVersion) return;
      loadedProjectIds.current.add(projectId);
      setSessionsByProject((current) => ({ ...current, [projectId]: sessions }));
    } catch (cause) {
      if (requestVersions.current.get(projectId) !== requestVersion) return;
      setErrorsByProject((current) => ({ ...current, [projectId]: cause instanceof Error ? cause.message : "无法加载工作线" }));
    } finally {
      if (requestVersions.current.get(projectId) !== requestVersion) return;
      loadingRequests.current.delete(projectId);
      setLoadingProjectIds((current) => {
        const next = new Set(current);
        next.delete(projectId);
        return next;
      });
    }
  }, []);

  const toggleProject = useCallback((projectId: string) => {
    const expand = !expandedProjectIds.has(projectId);
    if(expand&&!loadedProjectIds.current.has(projectId))setLoadingProjectIds(current=>new Set(current).add(projectId));
    setExpandedProjectIds((current) => {
      const next = new Set(current);
      if (expand) next.add(projectId);
      else next.delete(projectId);
      return next;
    });
  }, [expandedProjectIds]);

  const updateProjectSessions = useCallback((projectId: string, sessions: Session[]) => {
    requestVersions.current.set(projectId,(requestVersions.current.get(projectId)??0)+1);
    loadingRequests.current.delete(projectId);
    setLoadingProjectIds(current=>{if(!current.has(projectId))return current;const next=new Set(current);next.delete(projectId);return next;});
    loadedProjectIds.current.add(projectId);
    setSessionsByProject((current) => current[projectId] === sessions ? current : { ...current, [projectId]: sessions });
    setErrorsByProject((current) => {
      if (!current[projectId]) return current;
      const next = { ...current };
      delete next[projectId];
      return next;
    });
  }, []);

  const expandedKey=JSON.stringify([...expandedProjectIds].sort());
  useEffect(()=>{
    const releases=(JSON.parse(expandedKey) as string[]).map(id=>subscribeApplicationResource<Session[]>(`/api/projects/${id}/sessions`,sessions=>updateProjectSessions(id,sessions),message=>{setLoadingProjectIds(current=>{const next=new Set(current);next.delete(id);return next;});setErrorsByProject(current=>({...current,[id]:message}));}));
    return ()=>{for(const release of releases)release();};
  },[expandedKey,updateProjectSessions]);

  const createProjectSession = useCallback(async (projectId: string, body: Record<string,unknown> = {}) => {
    const session = await api.createSession(projectId,body);
    requestVersions.current.set(projectId, (requestVersions.current.get(projectId) ?? 0) + 1);
    loadingRequests.current.delete(projectId);
    loadedProjectIds.current.add(projectId);
    setLoadingProjectIds((current) => {
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
    setSessionsByProject((current) => {
      const sessions = current[projectId] ?? [];
      return sessions.some((item) => item.id === session.id)
        ? current
        : { ...current, [projectId]: [...sessions, session] };
    });
    setExpandedProjectIds((current) => new Set(current).add(projectId));
    setErrorsByProject((current) => {
      if (!current[projectId]) return current;
      const next = { ...current };
      delete next[projectId];
      return next;
    });
    return session;
  }, []);

  const removeSession = (projectId: string, sessionId: string) => {
    requestVersions.current.set(projectId, (requestVersions.current.get(projectId) ?? 0) + 1);
    loadingRequests.current.delete(projectId);
    setLoadingProjectIds(current => { const next = new Set(current); next.delete(projectId); return next; });
    setSessionsByProject(current => ({...current, [projectId]: (current[projectId] ?? []).filter(item => item.id !== sessionId)}));
  };
  return { removeSession, expandedProjectIds, sessionsByProject, loadingProjectIds, errorsByProject, toggleProject, loadProjectSessions, updateProjectSessions, createProjectSession };
}
