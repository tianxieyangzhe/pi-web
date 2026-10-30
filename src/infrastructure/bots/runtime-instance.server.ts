import "server-only";
import { randomUUID } from "node:crypto";

const processState = globalThis as typeof globalThis & { __botRuntimeInstanceId?: string };
export const botRuntimeInstanceId = processState.__botRuntimeInstanceId ??= randomUUID();
