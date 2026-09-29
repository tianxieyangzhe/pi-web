import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

export const submitTaskResultTool: ToolDefinition<any, any, any> = {
  name: "submit_task_result",
  label: "submit_task_result",
  description: "提交当前项目任务的结构化完成、阻塞或失败结果。",
  promptSnippet: "Submit one structured task result before finishing a project task.",
  promptGuidelines: [
    "Use this tool exactly once after completing, blocking, or failing the current task.",
    "Only report artifacts inside the current project using relative paths.",
  ],
  parameters: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["completed", "blocked", "failed"] },
      summary: { type: "string" },
      artifacts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            description: { type: "string" },
          },
          required: ["path", "description"],
          additionalProperties: false,
        },
      },
      risks: { type: "array", items: { type: "string" } },
      nextActions: { type: "array", items: { type: "string" } },
    },
    required: ["status", "summary", "artifacts", "risks", "nextActions"],
    additionalProperties: false,
  } as any,
  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text", text: "已提交任务结果。" }],
      details: params,
    };
  },
};
