import { createHmac } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { stageForGame } from '../odds/f5-scope.js';
import { isActableGame } from './actable-game.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { inPrematchWindow } from '../pipeline/stage-needs.js';
import { decideSettlement, pendingFinalKey } from './office-settlement.js';

type Reason = 'window_open' | 'lineup_changed' | 'stage_changed' | 'f5_settled' | 'final';

@Injectable()
export class OfficeEventsService {
  private readonly logger = new Logger(OfficeEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Emit one office event when the lineup, the stage, or the prematch window changes. */
  async consider(gameId: string): Promise<void> {
    try {
      await this.considerUnsafe(gameId);
    } catch (err) {
      this.logger.warn(
        `office consider ${gameId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private async considerUnsafe(gameId: string): Promise<void> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        homeTeam: { select: { abbreviation: true } },
        awayTeam: { select: { abbreviation: true } },
        lineupPlayers: {
          select: { side: true, battingOrder: true, mlbPlayerId: true },
          orderBy: [{ side: 'asc' }, { battingOrder: 'asc' }],
        },
        officeCursor: true,
      },
    });
    if (!game) return;
    if (!isActableGame(game)) {
      // One gate at the point of decision: a synthetic game built by a rehearsal
      // must never reach the group, whatever path called us.
      this.logger.warn(
        `office event skipped for non-actable game pk=${game.mlbGamePk} (${game.statusDetail ?? ''})`,
      );
      return;
    }

    const stage = stageForGame(game.status, game.inning);
    const lineupKey = [
      game.homeProbableMlbId ?? '',
      game.awayProbableMlbId ?? '',
      ...game.lineupPlayers.map(
        (p) => `${p.side}:${p.battingOrder}:${p.mlbPlayerId ?? ''}`,
      ),
    ].join('|');
    const cursor = game.officeCursor;
    const inWindow =
      game.status === 'PREVIEW' && inPrematchWindow(game.gameDateUtc);
    const live = game.status === 'LIVE' || game.status === 'OTHER';

    if (!cursor && !inWindow && !live && game.status !== 'FINAL') {
      await this.save(gameId, { lineupKey, stageKey: stage });
      return;
    }

    const windowId = `${stage}|${lineupKey}`;
    const pendingAge = cursor
      ? Date.now() - cursor.updatedAt.getTime()
      : Number.POSITIVE_INFINITY;
    const settlement = decideSettlement(
      game.status,
      game.inning,
      cursor?.finalKey,
      pendingAge,
    );
    let reason: Reason | null = null;
    if (settlement === 'f5_settled' || settlement === 'final') {
      reason = settlement;
    } else if (settlement === 'hold') {
      reason = null;
    } else if (inWindow && !cursor?.windowKey) {
      reason = 'window_open';
    } else if (live && cursor?.stageKey !== stage) {
      reason = 'stage_changed';
    } else if ((inWindow || live) && cursor?.lineupKey !== lineupKey) {
      reason = 'lineup_changed';
    } else if (inWindow && cursor?.windowKey !== windowId) {
      reason = 'window_open';
    }

    if (!reason) {
      if (!cursor) await this.save(gameId, { lineupKey, stageKey: stage });
      return;
    }

    const sent = await this.emit({
      gameId: game.id,
      mlbGamePk: game.mlbGamePk,
      reason,
      stage,
      matchup: `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`,
      fingerprint: `${reason}|${stage}|${lineupKey}`,
      score:
        reason === 'final'
          ? { home: game.homeScore, away: game.awayScore }
          : undefined,
    });
    if (!sent) return;

    await this.save(gameId, {
      lineupKey,
      stageKey: stage,
      windowKey: reason === 'window_open' ? windowId : cursor?.windowKey,
      finalKey:
        reason === 'final' || reason === 'f5_settled'
          ? pendingFinalKey(reason)
          : cursor?.finalKey,
    });
  }

  /** Worker finished grading. Pending dispatches stay open until this lands. */
  async ackSettlement(gameId: string, reason: string) {
    if (reason !== 'f5_settled' && reason !== 'final') {
      throw new BadRequestException('reason must be f5_settled or final');
    }
    const cursor = await this.prisma.officeCursor.findUnique({ where: { gameId } });
    if (cursor?.finalKey === 'final' || (reason === 'f5_settled' && cursor?.finalKey === 'final_pending')) {
      return { ok: true, final_key: cursor.finalKey };
    }
    if (reason === 'f5_settled' && cursor?.finalKey === 'f5') {
      return { ok: true, final_key: 'f5' };
    }
    const finalKey = reason === 'final' ? 'final' : 'f5';
    await this.save(gameId, { finalKey });
    return { ok: true, final_key: finalKey };
  }

  private save(
    gameId: string,
    data: {
      lineupKey?: string | null;
      stageKey?: string | null;
      windowKey?: string | null;
      finalKey?: string | null;
    },
  ) {
    return this.prisma.officeCursor.upsert({
      where: { gameId },
      create: {
        gameId,
        lineupKey: data.lineupKey ?? null,
        stageKey: data.stageKey ?? null,
        windowKey: data.windowKey ?? null,
        finalKey: data.finalKey ?? null,
      },
      update: {
        lineupKey: data.lineupKey ?? undefined,
        stageKey: data.stageKey ?? undefined,
        windowKey: data.windowKey ?? undefined,
        finalKey: data.finalKey ?? undefined,
      },
    });
  }

  private async emit(event: {
    gameId: string;
    mlbGamePk: number;
    reason: Reason;
    stage: string;
    matchup: string;
    fingerprint: string;
    score?: { home: number | null; away: number | null };
  }): Promise<boolean> {
    const url = this.config.get<string>('HERMES_WEBHOOK_URL')?.trim();
    const secret = this.config.get<string>('HERMES_WEBHOOK_SECRET')?.trim();
    if (!url || !secret) {
      this.logger.warn('HERMES_WEBHOOK_URL or SECRET is empty — office event skipped');
      return false;
    }
    const body = JSON.stringify({
      event_type: 'platewire_game',
      game_id: event.gameId,
      mlb_game_pk: event.mlbGamePk,
      reason: event.reason,
      stage: event.stage,
      matchup: event.matchup,
      fingerprint: event.fingerprint,
      score: event.score ?? null,
    });
    const signature =
      'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature,
        'X-GitHub-Event': 'platewire_game',
        'X-Request-ID': `${event.gameId}:${event.fingerprint}`,
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const text = await response.text();
      this.logger.warn(
        `office webhook ${response.status} game=${event.mlbGamePk} ${text.slice(0, 180)}`,
      );
      return false;
    }
    this.logger.log(
      `office event ${event.reason} ${event.matchup} stage=${event.stage}`,
    );
    return true;
  }
}
