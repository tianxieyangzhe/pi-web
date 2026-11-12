import { assistantDocument, isAssistantDefinition, isLegacyAssistantDefinition, legacyAssistantDocument } from "../../src/domain/assistant-document";
import type { AgentDefinition } from "./models";

export function renderAgentMarkdown(value:{agentId?:string;revision?:number;kind:"project";name:string;description:string|null;definition:AgentDefinition}) {
  if(isAssistantDefinition(value.definition))return assistantDocument(value.definition).markdown;
  if(isLegacyAssistantDefinition(value.definition))return legacyAssistantDocument(value.definition).markdown;
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
    (value.definition.instructions??'').trimEnd(),
    ""
  ].join("\n");
}
