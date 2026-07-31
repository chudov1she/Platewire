import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  composeRichHtml,
  type RichAlertPayload,
} from './telegram-rich.js';

const TG_MAX_MESSAGE = 4096;

@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);

  constructor(private readonly config: ConfigService) {}

  /** Token present (chat / updates). Independent of TELEGRAM_NOTIFY_ENABLED. */
  hasBotToken(): boolean {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    return Boolean(token && !token.includes('replace-with'));
  }

  isConfigured(): boolean {
    const enabled = this.config.get<string>('TELEGRAM_NOTIFY_ENABLED');
    if (enabled != null && enabled !== '' && enabled !== '1') {
      const off =
        enabled === '0' || enabled.toLowerCase() === 'false';
      if (off) return false;
    }
    return this.hasBotToken();
  }

  private token(): string | null {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token || token.includes('replace-with')) return null;
    return token;
  }

  async sendChatAction(
    chatId: string,
    action: 'typing' | 'upload_document' = 'typing',
  ): Promise<void> {
    const token = this.token();
    if (!token) return;
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, action }),
      });
    } catch {
      /* ignore */
    }
  }

  async sendHtml(chatId: string, html: string): Promise<boolean> {
    const token = this.token();
    if (!token) return false;
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: html,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        },
      );
      const data = (await res.json()) as { ok?: boolean; description?: string };
      if (!data.ok) {
        this.logger.warn(`sendHtml ${chatId}: ${data.description ?? res.status}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(
        `sendHtml ${chatId}: ${err instanceof Error ? err.message : err}`,
      );
      return false;
    }
  }

  /** Escape plain text and send as HTML, splitting on Telegram's 4096 limit. */
  async sendPlainText(chatId: string, text: string): Promise<boolean> {
    const chunks = splitTelegramChunks(escapeHtml(text));
    let ok = true;
    for (const chunk of chunks) {
      const sent = await this.sendHtml(chatId, chunk);
      if (!sent) ok = false;
    }
    return ok;
  }

  /** Rich table alert (Bot API 10.1), falls back to classic <pre> HTML. */
  async sendRichAlert(
    chatId: string,
    payload: RichAlertPayload,
  ): Promise<boolean> {
    const token = this.token();
    if (!token) return false;

    const richHtml = composeRichHtml({
      title: payload.title,
      tableHtml: payload.tableHtml,
      footer: payload.footer,
    });

    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendRichMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            rich_message: { html: richHtml },
          }),
        },
      );
      const data = (await res.json()) as { ok?: boolean; description?: string };
      if (data.ok) return true;
      throw new Error(data.description ?? 'sendRichMessage failed');
    } catch (richErr) {
      this.logger.debug(
        `sendRichMessage unavailable (${richErr instanceof Error ? richErr.message : richErr}); fallback HTML`,
      );
      return this.sendHtml(chatId, payload.fallbackHtml);
    }
  }
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Split escaped HTML so each chunk stays within Telegram message length. */
export function splitTelegramChunks(
  text: string,
  max = TG_MAX_MESSAGE,
): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = max;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest.length) chunks.push(rest);
  return chunks;
}
