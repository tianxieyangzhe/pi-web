import { useCallback, useRef, useState } from "react";
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
    setExpandedProjectIds((current) => {
      const next = new Set(current);
      if (expand) next.add(projectId);
      else next.delete(projectId);
      return next;
    });
    if (expand) void loadProjectSessions(projectId);
  }, [expandedProjectIds, loadProjectSessions]);

  const updateProjectSessions = useCallback((projectId: string, sessions: Session[]) => {
    loadedProjectIds.current.add(projectId);
    setSessionsByProject((current) => current[projectId] === sessions ? current : { ...current, [projectId]: sessions });
    setErrorsByProject((current) => {
      if (!current[projectId]) return current;
      const next = { ...current };
      delete next[projectId];
      return next;
    });
  }, []);

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

  return { expandedProjectIds, sessionsByProject, loadingProjectIds, errorsByProject, toggleProject, loadProjectSessions, updateProjectSessions, createProjectSession };
}
