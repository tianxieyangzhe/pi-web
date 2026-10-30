export type WorkspaceSelection =
  | { kind: "project"; projectId: string; sessionId?: string }
  | { kind: "bot"; botId: string }
  | { kind: "bot-conversation"; botId: string; conversationId: string };

export function isSelected(selection: WorkspaceSelection | null, kind: "project" | "project-session" | "bot" | "bot-conversation", id: string): boolean {
  if (!selection) return false;
  if (kind === "project-session") return selection.kind === "project" && selection.sessionId === id;
  if (kind === "project") return selection.kind === "project" && !selection.sessionId && selection.projectId === id;
  if (kind === "bot") return selection.kind === "bot" && selection.botId === id;
  return selection.kind === "bot-conversation" && selection.conversationId === id;
}

export function selectedProjectId(selection: WorkspaceSelection | null): string | null {
  return selection?.kind === "project" ? selection.projectId : null;
}
