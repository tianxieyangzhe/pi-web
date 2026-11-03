import { useEffect, useRef, useState } from "react";
import { botApi } from "../../../api/bot-client";
import type { BotDetail } from "../../../domain/bot";
import { useSessionTree } from "../use-session-tree";

export function useBotConversation(botId: string | null, conversationId: string | null) {
  const [detail, setDetail] = useState<BotDetail | null>(null), [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const base = botId && conversationId ? `/api/bots/${botId}/conversations/${conversationId}` : null;
  const selected = useRef(base); selected.current = base;
  const updateDetail = async () => { if (!botId || !conversationId) return; const value = await botApi.detail(botId, conversationId); if (selected.current === base) setDetail(value); };
  const state = useSessionTree(base, () => botApi.messages(botId!, conversationId!), updateDetail);
  useEffect(() => { setDetail(null); setActionErrors({}); }, [base]);
  const messages = state.tree.entries.map(({ entry }) => ({ id: entry.id, content: "", role: (entry.message as { role?: string })?.role ?? entry.type }));
  return { ...state, detail, messages, actionErrors,
    clearActionError: (scope = "coordinator") => setActionErrors(current => { const next = { ...current }; delete next[scope]; return next; }),
    async send(text: string, _targetSessionId?: string, references?: import("../../../../src/domain/message-references").MessageReference[]) {
      const target = base;
      setActionErrors({});
      try { await state.send(text, references); }
      catch (cause) { if (selected.current === target) setActionErrors({ coordinator: cause instanceof Error ? cause.message : "Bot 操作失败" }); throw cause; }
    },
  };
}
