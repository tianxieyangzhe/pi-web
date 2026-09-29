import { useLayoutEffect, useRef } from "react";
import type { ActivityEvent, ConversationMessage } from "../../../domain/models";
import { ActivityGroups } from "./activity-groups";
import { Response } from "./response";

export function Conversation({ messages, pendingText, streamingText, activities, running }: { messages: ConversationMessage[]; pendingText: string; streamingText: string; activities: ActivityEvent[]; running: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
  }, [activities, messages, pendingText, running, streamingText]);

  return <section className="conversation">
    {messages.map((message) => <div className="conversation__turn" key={message.id}>
      {message.role === "assistant" && <ActivityGroups activities={message.activities ?? []} history />}
      {Boolean(message.content) && <article className={`message message--${message.role}`}>
        <div className="message__role">{message.role === "user" ? "你" : "输出"}</div>
        <div className="message__content">{message.role === "assistant" ? <Response>{message.content}</Response> : message.content}</div>
      </article>}
    </div>)}
    {pendingText && <article className="message message--user"><div className="message__role">你</div><div className="message__content">{pendingText}</div></article>}
    <ActivityGroups activities={activities} running={running} />
    {streamingText && <article className="message message--assistant"><div className="message__role">输出</div><div className="message__content"><Response>{streamingText}</Response></div></article>}
    <div ref={bottomRef} aria-hidden="true" />
  </section>;
}
