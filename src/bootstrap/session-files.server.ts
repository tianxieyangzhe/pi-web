import 'server-only';
import { createSessionFileService } from '@/application/session-file-service';
import { sessionRepository } from '@/infrastructure/database/session-repository.server';
import { readSessionFile } from '@/infrastructure/references/session-file-reader.server';

export const projectSessionFiles = createSessionFileService((projectId, sessionId) => {
  const session = sessionRepository.get(sessionId);
  return session?.projectId === projectId ? session : null;
}, readSessionFile);
