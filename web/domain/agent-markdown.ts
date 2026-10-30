import type { AgentDefinition } from "./models";

export function renderAgentMarkdown(value:{agentId?:string;revision?:number;kind:"coordinator"|"project";name:string;description:string|null;definition:AgentDefinition}) {
  return [
    "---",
    `agent_id: ${JSON.stringify(value.agentId??"<保存时生成>")}`,
    `revision: ${value.revision??"<保存时生成>"}`,
    `kind: ${value.kind}`,
    `name: ${JSON.stringify(value.name)}`,
    `description: ${JSON.stringify(value.description)}`,
    `capabilities: ${JSON.stringify(value.definition.capabilities)}`,
    "---",
    "",
    value.definition.instructions.trimEnd(),
    ""
  ].join("\n");
}
