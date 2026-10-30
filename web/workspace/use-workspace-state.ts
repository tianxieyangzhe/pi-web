import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Agent, Mcp, Project } from "../domain/models";

export function useWorkspaceState() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [mcps, setMcps] = useState<Mcp[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [nextProjects, nextAgents, nextMcps] = await Promise.all([api.listProjects(), api.listAgents(), api.listMcps()]);
      setProjects(nextProjects); setAgents(nextAgents); setMcps(nextMcps);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法加载工作区"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

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
  return { projects, agents, mcps, reload, saveResource, deleteResource, error, setError, loading };
}
