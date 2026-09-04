import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
 * Long-poll getUpdates for basic bot commands.
 * Agent chat was removed — betting desk lives outside Platewire.
 */
@Injectable()
export class TelegramUpdatesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramUpdatesService.name);
  private offset = 0;
  private stopped = false;
  private loop?: Promise<void>;

  constructor(
    private readonly config: ConfigService,
    private readonly bot: TelegramBotService,
    private readonly users: UsersService,
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
    this.logger.log('Telegram inbound polling started (commands only)');
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
    if (!cmd) {
      await this.bot.sendHtml(
        chatIdStr,
        'Platewire собирает данные по матчам. Чат-агент и ставки отключены — смотри веб-приложение или API <code>/games/:id/pack</code>.',
      );
      return;
    }

    await this.handleCommand(cmd.name, chatIdStr, String(from.id));
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
          '<b>Platewire</b> — коллектор данных MLB',
          '',
          'Войди на сайт через Telegram Login.',
          'Ставки и AI-агент живут снаружи (Hermes + Game Pack API).',
          '',
          'Команды:',
          '/help — эта справка',
        ].join('\n'),
      );
      return;
    }

    if (name === 'clear') {
      const user = await this.users.findByTelegramId(telegramId);
      if (!user) {
        await this.bot.sendHtml(
          chatId,
          'Нет доступа. Войди на сайт через Telegram.',
        );
        return;
      }
      await this.bot.sendHtml(
        chatId,
        'Чат-агент отключён — очищать нечего.',
      );
      return;
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
