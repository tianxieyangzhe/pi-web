import { database, assertSchemaCompatible } from './database.server';
import { createSessionRepository } from './session-repository';
export const sessionRepository = createSessionRepository(database, assertSchemaCompatible);
export type { CreateSessionRecord } from '@/application/ports/core';
