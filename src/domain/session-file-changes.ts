export type NativeEdit = { entryId: string; patch: string; firstChangedLine: number | null };
export type ChangedFile = { id: string; path: string; projectPath: string | null; editCount: number };
export type SessionFileChanges = {
  runId: string | null;
  status: 'not_recorded' | 'boundary_unavailable' | 'running' | 'recorded';
  notice: string | null;
  files: ChangedFile[];
};
export type FileChangeContent = { runId: string; fileId: string; edits: NativeEdit[] };
