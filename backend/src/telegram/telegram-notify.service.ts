import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { formatBetAlert } from './telegram-format.js';
import { TelegramBotService } from './telegram-bot.service.js';

export type NotifyLedgerSnapshot = {
  gameId: string;
  track: string;
  action: string;
  pickMarket: string | null;
  pickSide: string | null;
  pickLine: number | null;
  decimalOdds: number | null;
  valuePct: number | null;
  roiPct: number | null;
  stakeUnits: number | null;
  confidenceTier: string | null;
  notifyBrief: string | null;
  captureReason: string | null;
  formulaVersionId: string;
  formulaVersionLabel: string;
  awayAbbr: string;
  homeAbbr: string;
  gameDateUtc: Date;
  awayScore?: number | null;
  homeScore?: number | null;
};

@Injectable()
export class TelegramNotifyService {
  private readonly logger = new Logger(TelegramNotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: TelegramBotService,
    private readonly config: ConfigService,
  ) {}

  /**
   * After a successful ledger write: notify on primary bet, or on material
   * recalc changes (including bet→pass).
   */
  async notifyAfterCapture(opts: {
    entry: NotifyLedgerSnapshot;
    isRecalc: boolean;
    materialChange: boolean;
    previous?: {
      action: string;
      pickMarket: string | null;
      pickSide: string | null;
      pickLine: number | null;
      decimalOdds: number | null;
    } | null;
  }): Promise<{ sent: number; skipped: string | null }> {
    if (!this.bot.isConfigured()) {
      return { sent: 0, skipped: 'disabled' };
    }

    const { entry, isRecalc, materialChange, previous = null } = opts;
    if (!isRecalc && entry.action !== 'bet') {
      return { sent: 0, skipped: 'pass_primary' };
    }
    if (isRecalc && !materialChange) {
      return { sent: 0, skipped: 'no_material_change' };
    }
    if (isRecalc && entry.action === 'pass' && !materialChange) {
      return { sent: 0, skipped: 'pass_unchanged' };
    }

    const pickKey = [
      entry.action,
      entry.pickMarket ?? '',
      entry.pickSide ?? '',
      entry.pickLine ?? '',
      entry.stakeUnits ?? '',
    ].join('/');
    const fingerprint = createHash('sha1')
      .update(
        [
          entry.track,
          entry.formulaVersionId,
          entry.gameDateUtc.toISOString(),
          entry.captureReason ?? 'ok',
          pickKey,
        ].join('|'),
      )
      .digest('hex');

    const prev = await this.prisma.telegramNotifyState.findUnique({
      where: { gameId: entry.gameId },
    });
    if (prev?.fingerprint === fingerprint) {
      return { sent: 0, skipped: 'already_sent' };
    }

    const brief =
      entry.notifyBrief?.trim() ||
      (entry.action === 'bet'
        ? 'Ставка по решению AI на этом этапе.'
        : 'Перерасчёт: решение сменилось на pass.');

    const pick =
      entry.action === 'bet' &&
      entry.pickMarket &&
      entry.pickSide &&
      entry.decimalOdds != null
        ? {
            market: entry.pickMarket,
            side: entry.pickSide,
            line: entry.pickLine,
            decimalOdds: entry.decimalOdds,
            valuePct: entry.valuePct ?? 0,
            roiPct: entry.roiPct ?? 0,
          }
        : null;

    const payload = formatBetAlert({
      awayAbbr: entry.awayAbbr,
      homeAbbr: entry.homeAbbr,
      track: entry.track,
      pick,
      notifyBrief: brief,
      versionLabel: entry.formulaVersionLabel,
      stakeUnits: entry.stakeUnits,
      confidenceTier: entry.confidenceTier,
      captureReason: entry.captureReason,
      awayScore: entry.awayScore,
      homeScore: entry.homeScore,
      action: entry.action,
      previousPick: isRecalc ? previous : null,
    });

    const recipients = await this.resolveRecipients();
    if (!recipients.length) {
      return { sent: 0, skipped: 'no_recipients' };
    }

    let sent = 0;
    for (const chatId of recipients) {
      const ok = await this.bot.sendRichAlert(chatId, payload);
      if (ok) sent += 1;
    }

    if (sent > 0) {
      await this.prisma.telegramNotifyState.upsert({
        where: { gameId: entry.gameId },
        create: {
          gameId: entry.gameId,
          fingerprint,
          payloadJson: {
            title: payload.title,
            footer: payload.footer,
            track: entry.track,
            action: entry.action,
          } as Prisma.InputJsonValue,
          lastSentAt: new Date(),
        },
        update: {
          fingerprint,
          payloadJson: {
            title: payload.title,
            footer: payload.footer,
            track: entry.track,
            action: entry.action,
          } as Prisma.InputJsonValue,
          lastSentAt: new Date(),
        },
      });
    }

    this.logger.log(
      `tg notify game=${entry.gameId} track=${entry.track} sent=${sent}/${recipients.length}`,
    );
    return { sent, skipped: sent > 0 ? null : 'send_failed' };
  }

  async clearStateForGame(gameId: string): Promise<void> {
    await this.prisma.telegramNotifyState.deleteMany({ where: { gameId } });
  }

  private async resolveRecipients(): Promise<string[]> {
    const ids = new Set<string>();

    const envIds = this.config.get<string>('TELEGRAM_NOTIFY_CHAT_IDS') ?? '';
    for (const part of envIds.split(',')) {
      const id = part.trim();
      if (id) ids.add(id);
    }

    const admins = await this.prisma.user.findMany({
      where: {
        status: UserStatus.ADMIN,
        telegramId: { not: null },
      },
      select: { telegramId: true },
    });
    for (const u of admins) {
      if (u.telegramId) ids.add(u.telegramId);
    }

    return [...ids];
  }
}
