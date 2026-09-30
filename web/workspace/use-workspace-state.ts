import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Agent, Mcp, Project, Room, RoomEntry } from "../domain/models";

export function useWorkspaceState() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [mcps, setMcps] = useState<Mcp[]>([]);
  const [rooms, setRooms] = useState<RoomEntry[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [nextProjects, nextAgents, nextMcps, nextRooms] = await Promise.all([api.listProjects(), api.listAgents(), api.listMcps(), api.listRoomEntries()]);
      setProjects(nextProjects); setAgents(nextAgents); setMcps(nextMcps); setRooms(nextRooms);
      setSelectedProjectId((current) => current && nextProjects.some((item) => item.id === current) ? current : nextProjects[0]?.id ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法加载工作区"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  function selectProject(id: string) { setSelectedProjectId(id); setSelectedRoomId(null); }
  function selectRoom(id: string) { setSelectedRoomId(id); setSelectedProjectId(null); }
  async function saveResource(kind: "project" | "agent" | "mcp", id: string | null, body: Record<string, unknown>) {
    try {
      if (kind === "project") id ? await api.updateProject(id, body) : await api.createProject(body);
      if (kind === "agent") id ? await api.updateAgent(id, body) : await api.createAgent(body);
      if (kind === "mcp") id ? await api.updateMcp(id, body) : await api.createMcp(body);
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法保存资源"); }
  }
  async function deleteResource(kind: "project" | "agent" | "mcp", id: string) {
    try {
      if (kind === "project") await api.deleteProject(id);
      if (kind === "agent") await api.deleteAgent(id);
      if (kind === "mcp") await api.deleteMcp(id);
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法删除资源"); }
  }
  async function createRoom(projectIds: string[], title: string) {
    try { const room = await api.createRoom({ kind: "cross_project", projectIds, title }); await reload(); selectRoom(room.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法创建跨项目会话"); }
  }
  async function updateRoom(id: string, body: Record<string, unknown>) { try { await api.updateRoom(id, body); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : "无法保存会话"); } }
  async function deleteRoom(id: string) { try { await api.deleteRoom(id); if (selectedRoomId === id) selectProject(projects[0]?.id ?? ""); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : "无法删除会话"); } }
  return { projects, agents, mcps, rooms, selectedProjectId, selectedRoomId, selectProject, selectRoom, reload, saveResource, deleteResource, createRoom, updateRoom, deleteRoom, error, setError, loading };
}
