import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { ActivityEvent, ConversationMessage } from "../../../domain/models";
import { Response } from "./response";

function ToolEntry({ activity, open = false }: { activity: ActivityEvent; open?: boolean }) {
  return <details className="activity" open={open}><summary><span>{activity.summary}</span></summary>{activity.detail && <div>{activity.detail}</div>}</details>;
}

export function Conversation({ messages, pendingText, streamingText, activities, liveEntries, running, waitingText, waitingIcon, progress, hiddenMessageIds, afterMessages, afterTurns }: { messages: ConversationMessage[]; pendingText: string; streamingText: string; activities: ActivityEvent[]; liveEntries?: Array<{ id: string; kind: "tool" | "text"; activity?: ActivityEvent; text?: string }>; running: boolean; waitingText?: string; waitingIcon?: ReactNode; progress?:string; hiddenMessageIds?:ReadonlySet<string>; afterMessages?:ReadonlyMap<string,ReactNode>; afterTurns?:ReadonlyMap<string,ReactNode> }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
  }, [activities, liveEntries, messages, pendingText, progress, running, streamingText]);

  return <section className="conversation">
    {messages.filter(message=>!hiddenMessageIds?.has(message.id)).map((message) => {
      const tool = message.entries?.find(entry => entry.kind === "tool" && entry.activity)?.activity;
      return <div key={message.id}>
        {tool ? <ToolEntry activity={tool} /> : message.content ? <article className={`message message--${message.role}`}>
          <div className="message__role">{message.role === "user" ? message.origin === "coordinator" ? "协调任务" : "你" : "输出"}</div>
          <div className="message__content">{message.role === "assistant" ? <Response>{message.content}</Response> : message.content}</div>
        </article> : null}
        {afterMessages?.get(message.id)??afterTurns?.get(message.id)}
      </div>;
    })}
    {pendingText && <article className="message message--user"><div className="message__role">你</div><div className="message__content">{pendingText}</div></article>}
    {waitingText && !liveEntries?.length && <p className="conversation-status" role="status">{waitingIcon}{waitingText}</p>}
    {(liveEntries ?? [
      ...(streamingText ? [{ id: "streaming-text", kind: "text" as const, text: streamingText }] : []),
      ...activities.filter(activity => activity.kind === "tool").map(activity => ({ id: activity.id, kind: "tool" as const, activity })),
    ] as Array<{ id: string; kind: "tool" | "text"; activity?: ActivityEvent; text?: string }>).map(entry => entry.kind === "tool" && entry.activity ? <ToolEntry activity={entry.activity} key={entry.id} open={entry.activity.state==="running"} /> : <article className="message message--assistant" key={entry.id}><div className="message__role">输出</div><div className="message__content"><Response>{entry.text ?? ""}</Response></div></article>)}
    <div ref={bottomRef} aria-hidden="true" />
  </section>;
}
