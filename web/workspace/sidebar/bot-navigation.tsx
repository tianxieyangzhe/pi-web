import { isSelected, type WorkspaceSelection } from "./workspace-selection";
import { ChevronDown, ChevronRight, Plus, Trash2, Bot as BotIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Bot, BotOverview } from "../../domain/bot";

export function BotNavigation({ value, selection, onBot, onCreate, onConversation, onProjectSession, onNewConversation, onDeleteConversation }: {
  value: BotOverview | null;
  selection: WorkspaceSelection | null;
  onBot: (id: string) => void;
  onCreate: () => void;
  onConversation: (id: string) => void;
  onProjectSession: (sessionId: string) => void;
  onNewConversation: (botId: string) => void | Promise<void>;
  onDeleteConversation: (conversationId: string) => void | Promise<void>;
}) {
  const selectedParticipant=selection?.kind==="project"&&selection.sessionId?value?.participants.find(item=>item.id===selection.sessionId):undefined,
    selectedConversationId=selection?.kind==="bot-conversation"?selection.conversationId:selectedParticipant?.botConversationId,
    selectedConversation=value?.conversations.find(item=>item.id===selectedConversationId),
    selectedBotId=selection?.kind==="bot-conversation"?selection.botId:selectedConversation?.botId;
  const [expandedBots, setExpandedBots] = useState<Set<string>>(() => selectedBotId ? new Set([selectedBotId]) : new Set()),
    [expandedConversations, setExpandedConversations] = useState<Set<string>>(() => selectedConversationId ? new Set([selectedConversationId]) : new Set()),
    [creatingBotIds, setCreatingBotIds] = useState<Set<string>>(new Set()),
    [deletingConversationIds, setDeletingConversationIds] = useState<Set<string>>(new Set()),
    pendingBotIds = useRef(new Set<string>()),
    pendingConversationIds = useRef(new Set<string>());

  useEffect(() => {
    if (selection?.kind === "bot-conversation") {
      setExpandedBots(current => current.has(selection.botId) ? current : new Set(current).add(selection.botId));
      setExpandedConversations(current => current.has(selection.conversationId) ? current : new Set(current).add(selection.conversationId));
      return;
    }
    if (selection?.kind === "project" && selection.sessionId) {
      const participant = value?.participants.find(item => item.id === selection.sessionId);
      const conversation = participant && value?.conversations.find(item => item.id === participant.botConversationId);
      if (participant && conversation) {
        setExpandedBots(current => current.has(conversation.botId) ? current : new Set(current).add(conversation.botId));
        setExpandedConversations(current => current.has(conversation.id) ? current : new Set(current).add(conversation.id));
      }
    }
  }, [selection, value?.participants, value?.conversations]);

  async function createConversation(botId: string) {
    if (pendingBotIds.current.has(botId)) return;
    pendingBotIds.current.add(botId);
    setCreatingBotIds(current => new Set(current).add(botId));
    try {
      await onNewConversation(botId);
    } finally {
      pendingBotIds.current.delete(botId);
      setCreatingBotIds(current => {
        const next = new Set(current);
        next.delete(botId);
        return next;
      });
    }
  }

  async function deleteConversation(conversationId: string, title: string) {
    if (pendingConversationIds.current.has(conversationId)) return;
    if (!window.confirm(`直接删除“${title}”？该协调会话和它的关联项目会话、记忆与 Pi 历史都会删除，不会存档。`)) return;
    pendingConversationIds.current.add(conversationId);
    setDeletingConversationIds(current => new Set(current).add(conversationId));
    try {
      await onDeleteConversation(conversationId);
    } finally {
      pendingConversationIds.current.delete(conversationId);
      setDeletingConversationIds(current => {
        const next = new Set(current);
        next.delete(conversationId);
        return next;
      });
    }
  }

  function toggle(setter: (update: (current: Set<string>) => Set<string>) => void, id: string) {
    setter(current => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function renderBot(bot: Bot) {
    const conversations = (value?.conversations ?? []).filter(conversation => conversation.botId === bot.id && conversation.status !== "archived"),
      titleCounts = new Map<string, number>();
    for (const conversation of conversations) {
      const title = conversation.title || "新对话";
      titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
    }
    return <div key={bot.id}>
      <div className="nav-row">
        <button className="project-session-toggle" aria-label={`${expandedBots.has(bot.id) ? "收起" : "展开"} ${bot.name} 的总对话`} aria-expanded={expandedBots.has(bot.id)} onClick={() => toggle(setExpandedBots, bot.id)}>{expandedBots.has(bot.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
        <button className={`project-link${isSelected(selection, "bot", bot.id) ? " active" : ""}`} aria-current={isSelected(selection, "bot", bot.id) ? "page" : undefined} onClick={() => { setExpandedBots(current => new Set(current).add(bot.id)); onBot(bot.id); }}><BotIcon size={14} /><span>{bot.name}</span></button>
        <button className="nav-icon" aria-label={`在 ${bot.name} 新建总对话`} aria-busy={creatingBotIds.has(bot.id)} disabled={creatingBotIds.has(bot.id)} title={creatingBotIds.has(bot.id) ? "正在创建总对话…" : undefined} onClick={() => { setExpandedBots(current => new Set(current).add(bot.id)); void createConversation(bot.id); }}><Plus size={13} /></button>
      </div>
      {expandedBots.has(bot.id) && <div className="bot-conversations" role="group" aria-label={`${bot.name} 的协调会话`}>{conversations.map(conversation => {
        const title = conversation.title || "新对话",
          duplicateTitle = (titleCounts.get(title) ?? 0) > 1,
          createdTime = duplicateTitle && conversation.createdAt ? new Date(conversation.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : null,
          sessions = (value?.participants ?? []).filter(participant => participant.botConversationId === conversation.id),
          conversationExpanded = expandedConversations.has(conversation.id);
        return <div key={conversation.id}>
          <div className="nav-row">
            {sessions.length > 0 ? <button className="project-session-toggle" aria-label={`${conversationExpanded ? "收起" : "展开"} ${title} 的项目会话`} aria-expanded={conversationExpanded} onClick={() => toggle(setExpandedConversations, conversation.id)}>{conversationExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : <span className="project-session-toggle project-session-toggle--empty" aria-hidden="true" />}
            <button className={`project-session-link${isSelected(selection, "bot-conversation", conversation.id) ? " active" : ""}`} aria-current={isSelected(selection, "bot-conversation", conversation.id) ? "page" : undefined} onClick={() => onConversation(conversation.id)}><span className="project-session-link__label">{title}</span><small>{createdTime ? `协调会话 · ${createdTime}` : "协调会话"}</small></button>
            <button className="nav-icon nav-icon--danger" aria-label={`删除协调会话 ${title}`} aria-busy={deletingConversationIds.has(conversation.id)} disabled={deletingConversationIds.has(conversation.id)} title={deletingConversationIds.has(conversation.id) ? "正在删除协调会话…" : "删除协调会话"} onClick={() => void deleteConversation(conversation.id, title)}><Trash2 size={13} /></button>
          </div>
          {sessions.length > 0 && conversationExpanded && <div className="bot-conversation-sessions" role="group" aria-label={`${title} 的项目会话`}>
            {sessions.map(session => {
              const topic = session.topic?.trim(), label = session.participantName?.trim() || topic || `${session.projectName ?? "项目"} · ${session.roleName}`;
              return <button className={`project-session-link${isSelected(selection, "project-session", session.id) ? " active" : ""}`} key={session.id} aria-current={isSelected(selection, "project-session", session.id) ? "page" : undefined} title={`${session.projectName ?? "项目"} · ${session.roleName} · ${label}`} onClick={() => onProjectSession(session.id)}>
                <span className="project-session-link__label">{label}</span><small>{session.projectName ?? "项目"} · {session.roleName}</small>
              </button>;
            })}
          </div>}
        </div>;
      })}</div>}
    </div>;
  }

  const activeBots = (value?.bots ?? []).filter(bot => bot.status !== "archived");

  return <section className="bot-navigation" aria-label="Bot 导航">
    <div className="sidebar__label">Bot<button className="nav-icon" aria-label="新建 Bot" onClick={onCreate}><Plus size={14} /></button></div>
    {value?.available === false && <p className="project-sessions__message">Bot 数据库待迁移，项目功能可继续使用。</p>}
    {activeBots.map(bot => renderBot(bot))}
  </section>;
}
