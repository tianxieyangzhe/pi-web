import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentRepositoryPort, McpRepositoryPort, ProjectRepositoryPort } from "@/application/ports/catalog";
import type { RoomContentRepositoryPort, RoomRepositoryPort, RoomRunRepositoryPort, SessionRepositoryPort, TaskRepositoryPort } from "@/application/ports/core";
import { DomainError } from "@/domain/errors";

export function createRoomContextService(dependencies: {
  rooms: RoomRepositoryPort;
  contents: RoomContentRepositoryPort;
  runs: RoomRunRepositoryPort;
  tasks: TaskRepositoryPort;
  sessions: SessionRepositoryPort;
  projects: ProjectRepositoryPort;
  agents: AgentRepositoryPort;
  mcps: McpRepositoryPort;
}) {
  const { rooms, contents, runs, tasks, sessions, projects, agents, mcps } = dependencies;
  return {
    build(roomId: string) {
      const room = rooms.get(roomId);
      if (!room) throw new DomainError("NOT_FOUND", "会话不存在", 404, true);
      const scope = rooms.listProjects(roomId);
      const scopeProjects = scope.map((item) => projects.get(item.projectId)).filter((item) => item !== null);
      const activeContents = contents.list(roomId).filter((item) => ["active", "adopted", "published"].includes(item.status));
      const recentRuns = runs.listForRoom(roomId).slice(0, 12);
      const recentTasks = tasks.listForRoom(roomId).slice(0, 24);
      const reusableSessions = sessions.listForRoom(roomId).filter((item) => ["not_started", "idle", "unavailable"].includes(item.state));
      const context = JSON.stringify({
        room: { id: room.id, kind: room.kind, title: room.title, contextRevision: room.contextRevision },
        scope: scopeProjects.map((project) => ({ id: project.id, name: project.name, description: project.description, kind: project.kind, status: project.status })),
        contents: activeContents.map((item) => ({ kind: item.kind, title: item.title, body: item.body, status: item.status })),
        recentRuns: recentRuns.map((run) => ({ request: run.requestText, route: run.route, state: run.state, response: run.finalResponse })),
        recentTasks: recentTasks.map((task) => ({ projectId: task.projectId, instruction: task.instruction, state: task.state, result: task.result ? { status: task.result.status, summary: task.result.summary } : null })),
        reusableSessions: reusableSessions.map((session) => ({ id: session.id, projectId: session.projectId, purpose: session.purpose, state: session.state, agentId: session.agentId })),
        agents: agents.list().filter((item) => item.status === "active").map((item) => ({ id: item.id, name: item.name, description: item.description, revision: item.revision, policy: item.policy })),
        mcps: mcps.list().filter((item) => item.status === "active").map((item) => ({ id: item.id, name: item.name, description: item.description, accessPolicy: item.accessPolicy })),
      }, null, 2);
      const runtimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ai-workspace-room-"));
      return {
        context,
        runtimeDirectory,
        cleanup() { fs.rmSync(runtimeDirectory, { recursive: true, force: true }); },
      };
    },
  };
}
