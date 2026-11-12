import type { ProjectMessageReference } from '@/domain/message-references';

export type SessionContextFile = {
  id: string;
  name: string;
  source: 'project';
  projectId: string;
  path: string;
  kind: 'document';
};
export type SessionContextFilesView = { files: SessionContextFile[]; writeETag: string };
export interface SessionContextFilesStore {
  read(sessionId: string): SessionContextFilesView;
  add(sessionId: string, references: ProjectMessageReference[], etag: string, resolve: (reference: { projectId: string; path: string }) => { name: string; bytes: Buffer }): SessionContextFilesView;
  remove(sessionId: string, id: string, etag: string): SessionContextFilesView;
}
