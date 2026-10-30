export function cloneCapabilities<T extends object>(value: T): T {
  return {
    ...value
  };
}
export function roleMatches(role: {
  kind: string | null;
  botId: string | null;
  projectId: string | null;
  status: string;
}, kind: string, owner: string, status: string) {
  return (kind === 'all' || role.kind === kind) && (owner === 'all' || (owner === 'template' ? !role.botId && !role.projectId : role.botId === owner || role.projectId === owner)) && (status === 'all' || role.status === status);
}
export class CandidateVersion {
  private sequence = 0;
  next() {
    return ++this.sequence;
  }
  valid(value: number) {
    return value === this.sequence;
  }
  invalidate() {
    this.sequence++;
  }
}
