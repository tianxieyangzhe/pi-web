import { DomainError } from "@/domain/errors";
import type { BotRepositoryPort } from "@/application/ports/bot";

export function listBotReferenceFiles(repository: BotRepositoryPort, list: (root: string, path: string) => unknown, botId: string, conversationId: string, path: string) {
  const conversation = repository.get("bot_conversations", conversationId);
  if (!conversation || conversation.botId !== botId) throw new DomainError("NOT_FOUND", "协调会话不存在", 404, true);
  const owner = repository.get("bots", botId);
  if (!owner) throw new DomainError("NOT_FOUND", "Bot 不存在", 404, true);
  if (owner.status !== "active") throw new DomainError("BOT_UNAVAILABLE", "Bot 已停用", 409, true);
  return list(owner.workingDirectory, path);
}
