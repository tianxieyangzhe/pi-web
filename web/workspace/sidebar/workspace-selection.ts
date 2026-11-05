export type WorkspaceSelection =
  | { kind: 'workspace'; workspaceId: string; sessionId?: string }
  | { kind: 'project'; projectId: string; sessionId?: string };

export function isSelected(selection: WorkspaceSelection | null, kind: 'project' | 'project-session', id: string): boolean {
  if (selection?.kind !== 'project') return false;
  return kind === 'project-session'
    ? selection.sessionId === id
    : selection.projectId === id && !selection.sessionId;
}

export function selectedProjectId(selection: WorkspaceSelection | null): string | null {
  return selection?.kind === 'project' ? selection.projectId : null;
}
