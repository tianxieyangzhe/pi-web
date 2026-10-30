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
  origin?: "user" | "coordinator";
  content: string;
  createdAt: string;
  executionId: string | null;
  entries?: Array<{ id: string; kind: "text" | "tool"; text?: string; activity?: ActivityEvent }>;
};

const PUBLIC_SUMMARY_OPEN = "[[PI_PUBLIC_SUMMARY]]";
const PUBLIC_SUMMARY_CLOSE = "[[/PI_PUBLIC_SUMMARY]]";

function extractPublicSummary(value: string): { text: string } {
  const openIndex = value.indexOf(PUBLIC_SUMMARY_OPEN);
  if (openIndex < 0) return { text: value };
  const closeIndex = value.indexOf(PUBLIC_SUMMARY_CLOSE, openIndex + PUBLIC_SUMMARY_OPEN.length);
  if (closeIndex < 0) return { text: value.slice(0, openIndex) };
  return { text: value.slice(0, openIndex) + value.slice(closeIndex + PUBLIC_SUMMARY_CLOSE.length) };
}

function text(content: unknown) {
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.map(part => part && typeof part === "object" && part.type === "text" && typeof part.text === "string" ? part.text : "").join("") : "";
}

function clean(value: string) {
  return value.replace(/\[BOT_MESSAGE:[^\]]+\]\n?/g, "").replace(/\[BOT_EXECUTION:[^\]]+\]\n?/g, "").replace(/^\[协作消息 [^\]]+\]\n/, "");
}

export function projectTranscriptEntries(entries: readonly TranscriptProjectionEntry[], options: { workingDirectory: string; coordinatorExecutionIds?: ReadonlySet<string>; sanitize?: (value: string) => string }): ProjectedTranscriptMessage[] {
  const sanitize = options.sanitize ?? ((value: string) => value);
  const toolNames = new Map<string, string>(), toolArgs = new Map<string, unknown>(), executionByEntry = new Map<string, string | null>(), coordinatorEntryIds = new Set<string>();
  let activeExecutionId: string | null = null;
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === "bot_execution_start") {
      const executionId = (entry.data as { executionId?: unknown } | undefined)?.executionId;
      activeExecutionId = typeof executionId === "string" ? executionId : null;
      if (activeExecutionId && options.coordinatorExecutionIds?.has(activeExecutionId)) coordinatorEntryIds.add(entry.id);
    } else if (entry.type === "custom" && entry.customType === "bot_input_link") {
      const data = entry.data as { executionId?: unknown; inputNativeEntryId?: unknown } | undefined;
      if (typeof data?.executionId === "string" && typeof data.inputNativeEntryId === "string" && options.coordinatorExecutionIds?.has(data.executionId)) coordinatorEntryIds.add(data.inputNativeEntryId);
    } else if (entry.type === "message") {
      executionByEntry.set(entry.id, activeExecutionId);
      const message = entry.message as { role?: string; content?: unknown };
      if (message.role === "assistant" && Array.isArray(message.content)) for (const part of message.content) if (part?.type === "toolCall" && typeof part.id === "string") {
        toolNames.set(part.id, typeof part.name === "string" ? part.name : "");
        toolArgs.set(part.id, part.arguments);
      }
    } else if (entry.type === "custom" && entry.customType === "bot_execution_end") activeExecutionId = null;
  }
  const result: ProjectedTranscriptMessage[] = [];
  let coordinatorInput = false;
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === "bot_execution_start") {
      coordinatorInput = coordinatorEntryIds.has(entry.id);
      continue;
    }
    if (entry.type === "custom" && entry.customType === "bot_execution_end") {
      coordinatorInput = false;
      continue;
    }
    if (entry.type !== "message") continue;
    const message = entry.message as { role?: string; content?: unknown; toolCallId?: string; toolName?: string; isError?: boolean };
    const executionId = executionByEntry.get(entry.id) ?? null;
    if (message.role === "user") {
      const content = sanitize(clean(text(message.content)));
      if (!content) continue;
      result.push({ id: entry.id, role: "user", origin: coordinatorInput || coordinatorEntryIds.has(entry.id) || (executionId !== null && options.coordinatorExecutionIds?.has(executionId)) ? "coordinator" : "user", content, createdAt: entry.timestamp, executionId: executionId ?? null });
      continue;
    }
    if (message.role === "toolResult" && typeof message.toolCallId === "string") {
      const toolName = typeof message.toolName === "string" && message.toolName ? message.toolName : toolNames.get(message.toolCallId) ?? "";
      const failed = message.isError === true;
      const detail = safeToolTarget(toolName, toolArgs.get(message.toolCallId), options.workingDirectory);
      result.push({ id: entry.id, role: "assistant", content: "", createdAt: entry.timestamp, executionId: executionId ?? null, entries: [{ id: entry.id, kind: "tool", activity: { type: "activity", id: `history:${entry.id}`, kind: "tool", state: failed ? "error" : "completed", summary: `${failed ? "失败：" : ""}${toolName || "tool"}`, ...(detail ? { detail } : {}) } }] });
      continue;
    }
    if (message.role !== "assistant") continue;
    const blocks = Array.isArray(message.content) ? message.content.filter((part): part is Record<string, unknown> => Boolean(part) && typeof part === "object") : [];
    const textParts = blocks.flatMap(block => block.type === "text" && typeof block.text === "string" ? [sanitize(clean(extractPublicSummary(block.text).text)).trim()] : []).filter(Boolean);
    if (textParts.length) result.push({ id: entry.id, role: "assistant", content: textParts.join("\n\n"), createdAt: entry.timestamp, executionId: executionId ?? null });
  }
  return result;
}
