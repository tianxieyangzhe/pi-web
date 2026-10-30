import { isDomainError } from "@/domain/errors";

const safeCodes = new Set(["INVALID_INPUT", "INVALID_STATE", "NOT_FOUND", "PROJECT_UNAVAILABLE", "ROLE_BINDING_INVALID", "SESSION_BUSY", "RUNTIME_ERROR", "NO_NATIVE_REF", "SCHEMA_INCOMPATIBLE", "CONTEXT_LIMIT_REACHED", "REQUEST_ABORTED", "BOT_UNAVAILABLE"]);

export function coordinatorErrorCode(error: unknown): string {
  return isDomainError(error) && safeCodes.has(error.code) ? error.code : "OTHER";
}

export function coordinatorDiagnostic(data: {
  conversationId: string;
  stage: string;
  tool?: string;
  callId?: string;
  sessionId?: string;
  status?: string;
  errorCode?: string;
  elapsedMs?: number;
}) {
  try { console.info(`[coordinator-diagnostic] ${JSON.stringify(data)}`); } catch { /* diagnostics must not alter execution */ }
}
