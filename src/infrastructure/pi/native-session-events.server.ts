import { randomUUID } from "node:crypto";
import type { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "@/domain/models";

/** Subscribe outside prompt so project calls and other pages see the same native activity. */
export function subscribeNativeSession(session: AgentSession, manager: SessionManager, emit: (event: AgentEvent) => void) {
  const ids = new WeakMap<object, string>();
  const tools = new Map<string, string>();
  let current: string | null = null, closed = false;
  const unsubscribe = session.subscribe(event => {
    const message = "message" in event && event.message && typeof event.message === "object" ? event.message : null;
    if (event.type === "message_start" && message) { current = randomUUID(); ids.set(message, current); }
    const toolCallId = "toolCallId" in event && typeof event.toolCallId === "string" ? event.toolCallId : null;
    if (toolCallId && event.type === "tool_execution_start") tools.set(toolCallId, randomUUID());
    const temporaryId = toolCallId ? tools.get(toolCallId) ?? null : message ? ids.get(message) ?? current : current;
    emit({ type: "pi_event", piType: event.type, payload: JSON.parse(JSON.stringify(event)), temporaryId });
    if (event.type === "message_end" && message && temporaryId) {
      const locate = () => {
        const matches = manager.getEntries().filter(item => item.type === "message" ? item.message === message
          : item.type === "custom_message" && "role" in message && message.role === "custom" && "customType" in message && item.customType === message.customType && "content" in message && item.content === message.content && "details" in message && item.details === message.details);
        return matches.length === 1 ? matches[0] : undefined;
      };
      const link = () => {
        if (closed) return;
        const entry = locate();
        if (entry) {
          emit({ type: "entry_link", entryId: entry.id, temporaryId });
          const toolId = "toolCallId" in message && typeof message.toolCallId === "string" ? message.toolCallId : null;
          const toolTemporary = toolId ? tools.get(toolId) : null;
          if (toolTemporary) { emit({ type: "entry_link", entryId: entry.id, temporaryId: toolTemporary }); tools.delete(toolId!); }
        }
      };
      // Direct custom messages are already appended before SDK emits message_end.
      // Link those now, before prompt's agent_start can establish a new run identity.
      if (locate()) link(); else setImmediate(link);
      current = null;
    }
  });
  return () => { closed = true; unsubscribe(); };
}
