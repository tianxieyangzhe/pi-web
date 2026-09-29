import "server-only";

import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createOpenAIModelRuntime } from "@/infrastructure/pi/openai-model-config.server";

export type RouterDecision =
  | { kind: "direct"; response: string }
  | {
      kind: "dispatch";
      tasks: Array<{
        projectId: string;
        reuseSessionId: string | null;
        agentId: string | null;
        mcpIds: string[];
        instruction: string;
        acceptance: string[];
        operation: "read" | "project_write" | "external_write";
        risk: "low" | "medium" | "high";
      }>;
      synthesisRequired: boolean;
    };

export async function runRoomRouter(input: {
  cwd: string;
  context: string;
  request: string;
  signal?: AbortSignal;
  emit?: (event: { type: "activity"; kind: "thinking" | "execution"; summary: string }) => void;
}) {
  let decision: RouterDecision | null = null;
  const submitDecision: ToolDefinition<any, any, any> = {
    name: "submit_room_decision",
    label: "submit_room_decision",
    description: "Submit the single routing decision for the current request.",
    promptSnippet: "Submit exactly one direct reply or a project task dispatch plan.",
    promptGuidelines: [
      "Use direct when no project inspection or project action is required.",
      "Use dispatch only with project IDs present in the supplied Room scope context.",
      "Never invent IDs, file paths, permissions, or project capabilities.",
      "A direct response must be a complete answer. It must not say that work will be dispatched, inspected, executed, or returned later.",
    ],
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["direct", "dispatch"] },
        response: { type: "string" },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              projectId: { type: "string" },
              reuseSessionId: { type: ["string", "null"] },
              agentId: { type: ["string", "null"] },
              mcpIds: { type: "array", items: { type: "string" } },
              instruction: { type: "string" },
              acceptance: { type: "array", items: { type: "string" } },
              operation: { type: "string", enum: ["read", "project_write", "external_write"] },
              risk: { type: "string", enum: ["low", "medium", "high"] },
            },
            required: ["projectId", "reuseSessionId", "agentId", "mcpIds", "instruction", "acceptance", "operation", "risk"],
            additionalProperties: false,
          },
        },
        synthesisRequired: { type: "boolean" },
      },
      required: ["kind"],
      additionalProperties: false,
    } as any,
    async execute(_toolCallId, params) {
      const value = params as Record<string, unknown>;
      if (value.kind === "direct" && typeof value.response === "string") {
        decision = { kind: "direct", response: value.response };
      }
      if (value.kind === "dispatch" && Array.isArray(value.tasks) && typeof value.synthesisRequired === "boolean") {
        decision = {
          kind: "dispatch",
          tasks: value.tasks as RouterDecision extends { kind: "dispatch" } ? never : never,
          synthesisRequired: value.synthesisRequired,
        } as RouterDecision;
      }
      return { content: [{ type: "text", text: "Routing decision recorded." }], details: undefined };
    },
  };

  const loader = new DefaultResourceLoader({
    cwd: input.cwd,
    agentDir: getAgentDir(),
    noContextFiles: true,
    noSkills: true,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: [
      "You are a deterministic request router for a local multi-project workspace.",
      "You do not inspect files, execute tasks, or explain your internal reasoning.",
      "Use submit_room_decision exactly once. Prefer direct for ordinary discussion, planning, or questions answerable from the supplied context.",
      "Use dispatch only when a concrete project needs analysis or work. Use only resource IDs from the supplied context.",
      "Requests about a project's files, structure, configuration, dependencies, source code, or unknown project facts require a read dispatch. Do not answer those requests as direct.",
      "When choosing direct, provide a final answer only. Never promise to dispatch a project, inspect files, perform work, or return later.",
      "For read-only analysis choose operation read and risk low. Do not propose writing unless explicitly needed.",
      "Collaboration context:",
      input.context || "(empty)",
    ].join("\n\n"),
  });
  await loader.reload();
  const { runtime, model } = await createOpenAIModelRuntime();
  const created = await createAgentSession({
    cwd: input.cwd,
    sessionManager: SessionManager.inMemory(input.cwd),
    modelRuntime: runtime,
    resourceLoader: loader,
    model,
    noTools: "builtin",
    customTools: [submitDecision],
  });
  let thinkingStarted = false;
  const unsubscribe = created.session.subscribe((event) => {
    const value = event as { type?: string; toolName?: string; assistantMessageEvent?: { type?: string } };
    if (value.type === "message_update" && value.assistantMessageEvent?.type === "thinking_delta" && !thinkingStarted) {
      thinkingStarted = true;
      input.emit?.({ type: "activity", kind: "thinking", summary: "正在分析请求和可用项目" });
    }
    if (value.type === "tool_execution_start" && value.toolName === "submit_room_decision") {
      input.emit?.({ type: "activity", kind: "execution", summary: "正在生成项目执行计划" });
    }
  });
  const abort = () => { void created.session.abort(); };
  input.signal?.addEventListener("abort", abort, { once: true });
  if (input.signal?.aborted) abort();
  try {
    await created.session.prompt(input.request);
  } finally {
    unsubscribe();
    input.signal?.removeEventListener("abort", abort);
    created.session.dispose();
  }
  if (!decision) throw new Error("Router did not submit a routing decision");
  return decision;
}
