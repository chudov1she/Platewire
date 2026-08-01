import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  composeRichHtml,
  type RichAlertPayload,
} from './telegram-rich.js';
import {
  markdownToRichHtml,
  markdownToTelegramHtml,
} from './telegram-markdown.js';

const TG_MAX_MESSAGE = 4096;
/** Bot API 10.1 rich messages allow up to 32768 chars. */
const TG_RICH_MAX = 30000;

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

  /**
   * Agent Markdown via Bot API 10.1 sendRichMessage (native tables/headings/lists).
   * Falls back to rich HTML with <table>, then classic sendMessage HTML.
   */
  async sendMarkdown(chatId: string, markdown: string): Promise<boolean> {
    const md = markdown.trim();
    if (!md) return true;

    const richParts =
      md.length <= TG_RICH_MAX
        ? [md]
        : splitTelegramChunks(md, TG_RICH_MAX);

    let anyOk = false;
    for (const part of richParts) {
      // 1) Native rich Markdown — GFM tables render as real tables
      if (await this.sendRichMessage(chatId, { markdown: part })) {
        anyOk = true;
        continue;
      }
      // 2) Rich HTML with real <table> (same path as bet alerts)
      const richHtml = markdownToRichHtml(part);
      if (await this.sendRichMessage(chatId, { html: richHtml })) {
        anyOk = true;
        continue;
      }
      // 3) Classic sendMessage (tables degrade to <pre>)
      const classic = markdownToTelegramHtml(part);
      for (const chunk of splitTelegramHtmlChunks(classic)) {
        const sent = await this.sendHtml(chatId, chunk);
        if (sent) anyOk = true;
        else {
          const plain = escapeHtml(chunk.replace(/<[^>]+>/g, ''));
          if (await this.sendHtml(chatId, plain)) anyOk = true;
        }
      }
    }
    return anyOk;
  }

  /** Low-level Bot API 10.1 sendRichMessage. */
  async sendRichMessage(
    chatId: string,
    richMessage: { html?: string; markdown?: string },
  ): Promise<boolean> {
    const token = this.token();
    if (!token) return false;
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendRichMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            rich_message: richMessage,
          }),
        },
      );
      const data = (await res.json()) as { ok?: boolean; description?: string };
      if (!data.ok) {
        this.logger.debug(
          `sendRichMessage ${chatId}: ${data.description ?? res.status}`,
        );
        return false;
      }
      return true;
    } catch (err) {
      this.logger.debug(
        `sendRichMessage ${chatId}: ${err instanceof Error ? err.message : err}`,
      );
      return false;
    }
  }

  /** Rich table alert (Bot API 10.1), falls back to classic <pre> HTML. */
  async sendRichAlert(
    chatId: string,
    payload: RichAlertPayload,
  ): Promise<boolean> {
    const richHtml = composeRichHtml({
      title: payload.title,
      tableHtml: payload.tableHtml,
      footer: payload.footer,
    });
    if (await this.sendRichMessage(chatId, { html: richHtml })) return true;
    return this.sendHtml(chatId, payload.fallbackHtml);
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

/**
 * Split HTML on blank lines / block boundaries so we rarely cut inside a tag.
 * Falls back to hard char split if a single block is huge.
 */
export function splitTelegramHtmlChunks(
  html: string,
  max = TG_MAX_MESSAGE,
): string[] {
  if (html.length <= max) return [html];
  const blocks = html.split(/\n{2,}/);
  const chunks: string[] = [];
  let cur = '';
  const push = () => {
    if (cur) chunks.push(cur);
    cur = '';
  };
  for (const block of blocks) {
    const next = cur ? `${cur}\n\n${block}` : block;
    if (next.length <= max) {
      cur = next;
      continue;
    }
    push();
    if (block.length <= max) {
      cur = block;
    } else {
      chunks.push(...splitTelegramChunks(block, max));
    }
  }
  push();
  return chunks.length ? chunks : [html.slice(0, max)];
}
