import type { ActivityEvent, ConversationMessage } from "../domain/models";
import { Conversation as AiConversation } from "../shared/ui/ai-elements/conversation";

export function Conversation(props: { messages: ConversationMessage[]; pendingText: string; streamingText: string; activities: ActivityEvent[]; running: boolean }) {
  return <AiConversation {...props} />;
}
