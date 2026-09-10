import { getWorkspace } from "@/lib/workspace/workspace-manager.server";
import { ensureWorkspaceBaseline, listAgents, listMcpServers, listProjects } from "@/lib/workspace/workspace-data.server";

export type ObjectKind = "projects" | "mcp" | "agents";
export type ObjectRow = { id: string; name: string; detail: string; status: string };

function ensure(workspaceId: string) {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw new Error("Workspace 不存在");
  ensureWorkspaceBaseline({ workspaceId });
}

export function listWorkspaceObjects(workspaceId: string, kind: ObjectKind): ObjectRow[] {
  ensure(workspaceId);
  if (kind === "projects") return listProjects(workspaceId).map((project) => ({ id: project.id, name: project.name, detail: project.kind === "knowledge" ? "知识库" : "代码项目", status: project.status }));
  if (kind === "mcp") return listMcpServers(workspaceId).map((mcp) => ({ id: mcp.id, name: mcp.name, detail: mcp.transport, status: mcp.status }));
  return listAgents(workspaceId).map((agent) => ({ id: agent.id, name: agent.name, detail: agent.roleKind, status: agent.status }));
}
