import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '../generated/prisma/client.js';
import { AgentChatService } from '../ai/agent-chat.service.js';
import { UsersService } from '../users/users.service.js';
import { TelegramBotService } from './telegram-bot.service.js';

type TgUpdate = {
  update_id: number;
  message?: {
    text?: string;
    from?: {
      id: number;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    chat?: { id: number };
  };
};

/**
 * Long-poll getUpdates → route /commands or AgentChatService.send.
 * Shares AgentChatMessage history with the web agent pane.
 */
@Injectable()
export class TelegramUpdatesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramUpdatesService.name);
  private offset = 0;
  private stopped = false;
  private loop?: Promise<void>;
  /** Serialize agent replies per chat to avoid interleaved history. */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly bot: TelegramBotService,
    private readonly users: UsersService,
    private readonly agentChat: AgentChatService,
  ) {}

  onModuleInit() {
    if (!this.bot.hasBotToken()) {
      this.logger.warn('Telegram bot token missing — inbound chat disabled');
      return;
    }
    this.loop = this.pollLoop();
  }

  onModuleDestroy() {
    this.stopped = true;
  }

  private token(): string | null {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token || token.includes('replace-with')) return null;
    return token;
  }

  private async pollLoop() {
    await this.deleteWebhook();
    await this.drainOnce(true);
    this.logger.log('Telegram inbound chat polling started');
    while (!this.stopped) {
      try {
        await this.drainOnce(false);
      } catch (err) {
        this.logger.warn(
          `getUpdates: ${err instanceof Error ? err.message : err}`,
        );
        await sleep(2000);
      }
    }
  }

  private async deleteWebhook() {
    const token = this.token();
    if (!token) return;
    try {
      await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drop_pending_updates: false }),
      });
    } catch {
      /* ignore */
    }
  }

  private async drainOnce(dropOnly: boolean) {
    const token = this.token();
    if (!token) return;

    const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
    url.searchParams.set('timeout', dropOnly ? '0' : '25');
    url.searchParams.set('offset', String(this.offset));
    url.searchParams.set('allowed_updates', JSON.stringify(['message']));

    const res = await fetch(url, { signal: AbortSignal.timeout(35_000) });
    const body = (await res.json()) as {
      ok?: boolean;
      result?: TgUpdate[];
      description?: string;
    };
    if (!body.ok || !body.result) {
      throw new Error(body.description ?? `getUpdates ${res.status}`);
    }

    for (const upd of body.result) {
      this.offset = upd.update_id + 1;
      if (dropOnly) continue;
      try {
        await this.handleUpdate(upd);
      } catch (err) {
        this.logger.warn(
          `update ${upd.update_id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  private async handleUpdate(upd: TgUpdate) {
    const text = upd.message?.text?.trim() ?? '';
    const from = upd.message?.from;
    const chatId = upd.message?.chat?.id;
    if (!from || chatId == null || !text) return;

    const chatIdStr = String(chatId);
    const cmd = parseCommand(text);

    if (cmd) {
      await this.handleCommand(cmd.name, chatIdStr, String(from.id));
      return;
    }

    await this.handleAgentMessage(chatIdStr, String(from.id), text);
  }

  private async handleCommand(
    name: string,
    chatId: string,
    telegramId: string,
  ) {
    if (name === 'start' || name === 'help') {
      await this.bot.sendHtml(
        chatId,
        [
          '<b>Platewire AI agent</b>',
          '',
          'Пиши обычным текстом — тот же агент, что в веб-панели (матчи, формула, журнал).',
          '',
          'Команды:',
          '/help — эта справка',
          '/clear — сбросить историю диалога',
        ].join('\n'),
      );
      return;
    }

    if (name === 'clear') {
      const user = await this.users.findByTelegramId(telegramId);
      if (!user || user.status === UserStatus.GUEST) {
        await this.bot.sendHtml(
          chatId,
          'Нет доступа. Войди на сайт через Telegram (USER/ADMIN).',
        );
        return;
      }
      await this.agentChat.clear(user.id);
      await this.bot.sendHtml(chatId, 'История диалога очищена.');
      return;
    }

    // Unknown /command — ignore (do not forward to agent).
  }

  private async handleAgentMessage(
    chatId: string,
    telegramId: string,
    text: string,
  ) {
    if (this.inFlight.has(chatId)) {
      await this.bot.sendHtml(
        chatId,
        'Подожди — предыдущий ответ ещё считается.',
      );
      return;
    }

    const user = await this.users.findByTelegramId(telegramId);
    if (!user) {
      await this.bot.sendHtml(
        chatId,
        'Аккаунт не найден. Сначала войди на сайт через Telegram Login — ID привяжется к пользователю.',
      );
      return;
    }
    if (user.status === UserStatus.GUEST) {
      await this.bot.sendHtml(
        chatId,
        'Аккаунт пока <b>гость</b>. Попроси админа выдать USER/ADMIN, потом пиши снова.',
      );
      return;
    }

    this.inFlight.add(chatId);
    const typingTimer = setInterval(() => {
      void this.bot.sendChatAction(chatId, 'typing');
    }, 4000);
    try {
      await this.bot.sendChatAction(chatId, 'typing');
      const isAdmin = user.status === UserStatus.ADMIN;
      const result = await this.agentChat.send(user.id, text, isAdmin);
      const reply = result.message?.trim() || '(пустой ответ)';
      await this.bot.sendPlainText(chatId, reply);
    } catch (err) {
      this.logger.warn(
        `agent telegram chatId=${chatId}: ${err instanceof Error ? err.message : err}`,
      );
      await this.bot.sendHtml(
        chatId,
        `Ошибка агента: ${escapeForHtml(err instanceof Error ? err.message : String(err))}`,
      );
    } finally {
      clearInterval(typingTimer);
      this.inFlight.delete(chatId);
    }
  }
}

function parseCommand(
  text: string,
): { name: string; payload: string } | null {
  const m = /^\/([a-zA-Z0-9_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text);
  if (!m) return null;
  return { name: m[1].toLowerCase(), payload: (m[2] ?? '').trim() };
}

function escapeForHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
