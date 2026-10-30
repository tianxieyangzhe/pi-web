import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { DomainError } from "@/domain/errors";
import type { BotWorkspacePort } from "@/application/ports/bot";
export const botWorkspace: BotWorkspacePort = {
  async create(botId, selected) {
    const candidate = selected?.trim() || undefined;
    try {
      if (candidate && !path.isAbsolute(candidate)) throw new Error('absolute');
      const target = candidate ?? path.join(process.cwd(), '.data', 'bots', botId, 'workspace');
      if (!candidate) await fs.mkdir(target, {
        recursive: true
      });
      const workingDirectory = await fs.realpath(target);
      await this.validate(workingDirectory);
      return {
        workingDirectory,
        workspaceKind: candidate ? 'user_selected' : 'managed'
      };
    } catch {
      throw new DomainError('BOT_DIRECTORY_INVALID', 'Bot 工作目录必须是存在且可访问的绝对目录', 422, true);
    }
  },
  sessionDirectory: botId => path.join(process.cwd(), '.data', 'bots', botId, 'pi-sessions'),
  async validate(cwd) {
    try {
      if (!(await fs.stat(cwd)).isDirectory() || (await fs.realpath(cwd)) !== cwd) throw new Error('directory');
      await fs.access(cwd, fs.constants.R_OK);
    } catch {
      throw new DomainError('BOT_DIRECTORY_INVALID', 'Bot 工作目录不可用，未替换目录或历史', 409, true);
    }
  }
};
