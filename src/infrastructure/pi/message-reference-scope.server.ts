import { randomUUID } from "node:crypto";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

export function createMessageReferenceScope() {
  let activeId: string | undefined;
  const keep = <T>(messages: T[], currentId?: string): T[] => messages.filter(message => {
    const item = message as { role?: string; customType?: string; details?: { referenceTurnId?: unknown } };
    if (item.role !== "custom" || item.customType !== "user_reference_files") return true;
    return Boolean(currentId) && item.details?.referenceTurnId === currentId;
  });
  const extension: ExtensionFactory = pi => {
    pi.on("context", async event => ({ messages: keep(event.messages, activeId) }));
    pi.on("session_before_compact", async event => {
      event.preparation.messagesToSummarize = keep(event.preparation.messagesToSummarize);
      event.preparation.turnPrefixMessages = keep(event.preparation.turnPrefixMessages);
    });
  };
  return {
    extension,
    begin() { activeId = randomUUID(); return activeId; },
    end() { activeId = undefined; },
  };
}
