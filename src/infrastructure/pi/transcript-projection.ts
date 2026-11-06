import type { ActivityEvent } from "@/domain/models";
import { safeToolTarget } from "./tool-target";

export type TranscriptProjectionEntry = {
  id: string;
  type: string;
  timestamp: string;
  parentId?: string | null;
  customType?: string;
  data?: unknown;
  details?: unknown;
  message?: unknown;
};
export type ProjectedTranscriptMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  entries?: Array<{ id: string; kind: "text" | "tool"; text?: string; activity?: ActivityEvent }>;
};
function text(content: unknown) {
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.map(part => part && typeof part === "object" && part.type === "text" && typeof part.text === "string" ? part.text : "").join("") : "";
}

export function projectTranscriptEntries(entries: readonly TranscriptProjectionEntry[], options: { workingDirectory: string; sanitize?: (value: string) => string }): ProjectedTranscriptMessage[] {
  const sanitize = options.sanitize ?? ((value: string) => value);
  const toolNames = new Map<string, string>(), toolArgs = new Map<string, unknown>();
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message as { role?: string; content?: unknown };
    if (message.role === "assistant" && Array.isArray(message.content)) for (const part of message.content) if (part?.type === "toolCall" && typeof part.id === "string") {
      toolNames.set(part.id, typeof part.name === "string" ? part.name : "");
      toolArgs.set(part.id, part.arguments);
    }
  }
  const result: ProjectedTranscriptMessage[] = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message as { role?: string; content?: unknown; toolCallId?: string; toolName?: string; isError?: boolean };
    if (message.role === "user" || message.role === "assistant") {
      const content = sanitize(text(message.content));
      if (content) result.push({ id: entry.id, role: message.role, content, createdAt: entry.timestamp });
    } else if (message.role === "toolResult" && typeof message.toolCallId === "string") {
      const toolName = message.toolName || toolNames.get(message.toolCallId) || "tool";
      const detail = safeToolTarget(toolName, toolArgs.get(message.toolCallId), options.workingDirectory);
      result.push({ id: entry.id, role: "assistant", content: "", createdAt: entry.timestamp, entries: [{ id: entry.id, kind: "tool", activity: { type: "activity", id: `history:${entry.id}`, kind: "tool", state: message.isError ? "error" : "completed", summary: `${message.isError ? "失败：" : ""}${toolName}`, ...(detail ? { detail } : {}) } }] });
    }
  }
  return result;
}
