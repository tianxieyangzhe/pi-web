import { randomUUID } from "node:crypto";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

export function createMessageReferenceScope() {
  // Reference IDs identify the original send, not an expiry for native history.
  // Pi owns branch selection, the effective context window, and compaction.
  const extension: ExtensionFactory = () => {};
  return {
    extension,
    begin() { return randomUUID(); },
    end() {},
  };
}
