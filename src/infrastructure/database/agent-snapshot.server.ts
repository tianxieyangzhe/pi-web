import { isRoleSnapshot, snapshotReference, validateSnapshot, validateSnapshotReference, readSessionSnapshot } from "@/domain/agent-definition";
import type { AgentSnapshot, LegacyAgentSnapshot } from "@/domain/models";
import { readAgentVersion } from "@/infrastructure/agents/agent-file-store.server";
import { DomainError } from "@/domain/errors";

export type SessionAgentSnapshot = AgentSnapshot | LegacyAgentSnapshot | null;

export function hydrateAgentSnapshot(value: unknown): SessionAgentSnapshot {
  if (value === null) return null;
  if (value && typeof value === "object" && !Array.isArray(value) && "contentSha256" in value && !("definition" in value)) {
    const ref = validateSnapshotReference(value);
    const version = readAgentVersion(ref.agentId, ref.revision, ref.contentSha256);
    if (version.kind !== ref.kind || version.name !== ref.name || version.description !== ref.description) throw new DomainError("ROLE_FILE_INDEX_MISMATCH", "Agent 版本文件与绑定引用不一致", 409, true);
    return validateSnapshot({ ...ref, definition: version.definition });
  }
  const snapshot = readSessionSnapshot(value);
  if (snapshot && isRoleSnapshot(snapshot)) return validateSnapshot(snapshot);
  return snapshot;
}

export function serializeAgentSnapshot(value: SessionAgentSnapshot): unknown {
  if (!value) return null;
  return isRoleSnapshot(value) ? snapshotReference(value) : value;
}
