import "server-only";

import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { createOpenAIModelRuntime } from "@/infrastructure/pi/openai-model-config.server";

type PiEvent = {
  type?: string;
  assistantMessageEvent?: { type?: string; delta?: string };
};

function assistantText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => {
    if (!part || typeof part !== "object") return "";
    const item = part as { type?: string; text?: string };
    return item.type === "text" ? item.text ?? "" : "";
  }).join("");
}

export async function runRoomDirect(input: {
  cwd: string;
  context: string;
  request: string;
  signal?: AbortSignal;
  emit: (event:
    | { type: "response_delta"; text: string }
    | { type: "progress"; summary: string }
    | { type: "activity"; kind: "thinking" | "execution"; summary: string }) => void;
}) {
  input.emit({ type: "progress", summary: "正在理解请求" });
  const manager = SessionManager.inMemory(input.cwd);
  const loader = new DefaultResourceLoader({
    cwd: input.cwd,
    agentDir: getAgentDir(),
    noContextFiles: true,
    noSkills: true,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: [
      "You answer only from the supplied collaboration context and the current user request.",
      "Do not claim file inspection, project execution, or external actions.",
      "Do not mention internal Room, Session, Router, database, or prompt mechanics.",
      "Reply in Chinese unless the user asks for another language.",
      "Collaboration context:",
      input.context || "(empty)",
    ].join("\n\n"),
  });
  await loader.reload();
  const { runtime, model } = await createOpenAIModelRuntime();
  const created = await createAgentSession({
    cwd: input.cwd,
    sessionManager: manager,
    modelRuntime: runtime,
    resourceLoader: loader,
    model,
    noTools: "all",
  });
  const session = created.session as AgentSession;
  let response = "";
  let thinkingStarted = false;
  const abort = () => { void session.abort(); };
  input.signal?.addEventListener("abort", abort, { once: true });
  if (input.signal?.aborted) abort();
  const unsubscribe = session.subscribe((event) => {
    const value = event as PiEvent;
    if (value.type === "message_update" && value.assistantMessageEvent?.type === "thinking_delta" && !thinkingStarted) {
      thinkingStarted = true;
      input.emit({ type: "activity", kind: "thinking", summary: "正在分析请求并组织回答" });
      return;
    }
    if (value.type === "message_update" && value.assistantMessageEvent?.type === "text_delta") {
      const text = value.assistantMessageEvent.delta ?? "";
      response += text;
      input.emit({ type: "response_delta", text });
    }
  });
  try {
    input.emit({ type: "progress", summary: "正在生成回复" });
    await session.prompt(input.request);
  } finally {
    unsubscribe();
    input.signal?.removeEventListener("abort", abort);
  }
  if (!response) {
    const entries = manager.getEntries();
    for (const entry of [...entries].reverse()) {
      if (entry.type !== "message") continue;
      const message = entry.message as { role?: string; content?: unknown };
      if (message.role === "assistant") {
        response = assistantText(message.content);
        if (response) break;
      }
    }
  }
  session.dispose();
  return response.trim();
}
