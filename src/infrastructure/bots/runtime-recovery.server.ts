import "server-only";
import { recoverBotRuntimeOnce } from "@/bootstrap/bot-runtime-recovery";
import { database, schemaCompatible } from "@/infrastructure/database/database.server";
import { createBotRepository } from "@/infrastructure/database/bot-repository";
import { botRuntimeInstanceId } from "./runtime-instance.server";

const processState = globalThis as typeof globalThis & { __botRuntimeRecovered?: boolean };

export function recoverBotRuntimeAtStartup(): boolean {
  if (!schemaCompatible) return false;
  return recoverBotRuntimeOnce(createBotRepository(database), botRuntimeInstanceId, processState);
}
