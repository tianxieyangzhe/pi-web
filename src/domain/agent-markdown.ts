import { validateDefinition } from "./agent-definition";
import type { AgentDefinition } from "./models";

export type AgentMarkdownView = {
  agentId?: string;
  revision?: number;
  kind: "project";
  name: string;
  description: string | null;
  definition: AgentDefinition;
};

export function renderAgentMarkdown(value: AgentMarkdownView): string {
  const definition = validateDefinition(value.definition, value.kind);
  return [
    "---",
    `agent_id: ${JSON.stringify(value.agentId ?? "<保存时生成>")}`,
    `revision: ${value.revision ?? "<保存时生成>"}`,
    `kind: ${value.kind}`,
    `name: ${JSON.stringify(value.name)}`,
    `description: ${JSON.stringify(value.description)}`,
    `capabilities: ${JSON.stringify(definition.capabilities)}`,
    "---",
    "",
    definition.instructions.trimEnd(),
    ""
  ].join("\n");
}
