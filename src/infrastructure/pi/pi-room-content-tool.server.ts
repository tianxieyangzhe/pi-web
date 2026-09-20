import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

export const proposeRoomContentTool: ToolDefinition<any, any, any> = {
  name: "propose_room_content",
  label: "propose_room_content",
  description: "向用户提出一个可沉淀到当前会话的目标、方向或输出候选。该工具不会自动保存内容。",
  promptSnippet: "Propose structured Room goals, directions, and outputs for explicit user review",
  promptGuidelines: [
    "Use propose_room_content only when a durable goal, direction, decision, plan, delivery, note, or summary has emerged.",
    "A proposal is not saved until the user explicitly adopts or edits it.",
  ],
  parameters: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["goal", "direction", "output"] },
      outputKind: { type: "string", enum: ["note", "decision", "plan", "delivery", "summary"] },
      title: { type: "string" },
      body: { type: "string" },
    },
    required: ["kind", "title", "body"],
    additionalProperties: false,
  } as any,
  async execute(_toolCallId, params) {
    const value = params as { kind: string; outputKind?: string; title: string };
    if (value.kind === "output" && !value.outputKind) {
      throw new Error("output 候选必须提供 outputKind");
    }
    return {
      content: [{ type: "text", text: `已向用户提出结构内容候选：${value.title}` }],
      details: undefined,
    };
  },
};

export function createDelegateSessionTool(
  delegate: (purpose: string) => Promise<{ id: string }>,
): ToolDefinition<any, any, any> {
  return {
    name: "delegate_workline",
    label: "delegate_workline",
    description: "创建一条继承当前冻结配置的辅助工作线，用于并行处理一个明确目的。",
    promptSnippet: "Delegate independent work to a parallel worker Session",
    promptGuidelines: [
      "Delegate only work that has a clear independent purpose.",
      "The delegated workline inherits the current Session configuration and remains visible to the user.",
    ],
    executionMode: "sequential",
    parameters: {
      type: "object",
      properties: { purpose: { type: "string", minLength: 1 } },
      required: ["purpose"],
      additionalProperties: false,
    } as any,
    async execute(_toolCallId, params) {
      const purpose = (params as { purpose: string }).purpose.trim();
      if (!purpose) throw new Error("辅助工作线目的不能为空");
      const session = await delegate(purpose);
      return {
        content: [{ type: "text", text: `已创建辅助工作线 ${session.id}：${purpose}` }],
        details: { sessionId: session.id },
      };
    },
  };
}
