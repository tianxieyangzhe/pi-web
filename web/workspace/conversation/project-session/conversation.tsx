import { LoaderCircle } from "lucide-react";
import type { ActivityEvent, ConversationMessage } from "../../../domain/models";
import { Conversation as AiConversation } from "../ai-elements/conversation";

export function Conversation(props: { messages: ConversationMessage[]; pendingText: string; streamingText: string; activities: ActivityEvent[]; liveEntries?: Array<{ id: string; kind: "tool" | "text"; activity?: ActivityEvent; text?: string }>; running: boolean }) {
  return <AiConversation {...props} waitingText={props.running ? "正在思考" : ""} waitingIcon={<LoaderCircle className="spin" size={15} aria-hidden="true" />} />;
}
