import { createAgentSession, type CreateAgentSessionOptions } from "@earendil-works/pi-coding-agent";

/** Pi treats a metadata-only session as new. Reuse identical configuration entries on resume. */
export async function createPersistentAgentSession(options: CreateAgentSessionOptions) {
  const manager = options.sessionManager;
  if (!manager) return createAgentSession(options);
  const modelDescriptor = Object.getOwnPropertyDescriptor(manager, "appendModelChange");
  const thinkingDescriptor = Object.getOwnPropertyDescriptor(manager, "appendThinkingLevelChange");
  const appendModel = manager.appendModelChange;
  const appendThinking = manager.appendThinkingLevelChange;
  manager.appendModelChange = (provider, modelId) => {
    const previous = manager.getBranch().findLast(entry => entry.type === "model_change");
    return previous?.type === "model_change" && previous.provider === provider && previous.modelId === modelId
      ? previous.id : appendModel.call(manager, provider, modelId);
  };
  manager.appendThinkingLevelChange = level => {
    const previous = manager.getBranch().findLast(entry => entry.type === "thinking_level_change");
    return previous?.type === "thinking_level_change" && previous.thinkingLevel === level
      ? previous.id : appendThinking.call(manager, level);
  };
  try {
    return await createAgentSession(options);
  } finally {
    if (modelDescriptor) Object.defineProperty(manager, "appendModelChange", modelDescriptor);
    else Reflect.deleteProperty(manager, "appendModelChange");
    if (thinkingDescriptor) Object.defineProperty(manager, "appendThinkingLevelChange", thinkingDescriptor);
    else Reflect.deleteProperty(manager, "appendThinkingLevelChange");
  }
}
