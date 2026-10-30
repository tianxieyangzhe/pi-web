import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { BotTool } from "@/application/ports/bot";
export function toPiBotTools(tools: BotTool[]): ToolDefinition<any, any, any>[] {
  return tools.map(tool => ({
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters as any,
    executionMode: 'sequential',
    async execute(_id: string, args: Record<string, unknown>) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(await tool.execute(args))
        }],
        details: {}
      };
    }
  }));
}
