import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../generated/prisma/client.js';
import { mlbScheduleDateKey } from '../common/time.js';
import { ContextService } from '../context/context.service.js';
import { completedInnings } from '../odds/f5-scope.js';
import { OddsService } from '../odds/odds.service.js';
import { GamesService } from '../games/games.service.js';
import { GamesSyncService } from '../games/games-sync.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WeatherSyncService } from '../weather/weather-sync.service.js';
import {
  inPrematchWindow,
  needsStageWatch,
  stagesNeedingFreshCapture,
} from './stage-needs.js';

export type PipelineReason =
  | 'slate'
  | 'prematch'
  | 'stage_watch'
  | 'final_probe'
  | 'manual';

/**
 * Collection-only pipeline: live scores, weather, F5 odds, Savant/context.
 * No ledger capture, settle, or AI decisions.
 */
@Injectable()
export class GamePipelineService {
  private readonly logger = new Logger(GamePipelineService.name);
  private inFlight = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly games: GamesService,
    private readonly sync: GamesSyncService,
    private readonly odds: OddsService,
    private readonly config: ConfigService,
    private readonly weather: WeatherSyncService,
    private readonly context: ContextService,
  ) {}

  isEnabled(): boolean {
    const raw = this.config.get<string>('PIPELINE_ENABLED');
    if (raw == null || raw === '') return true;
    return raw !== '0' && raw.toLowerCase() !== 'false';
  }

  getInFlight(): number {
    return this.inFlight;
  }

  async tickGame(gameId: string): Promise<{
    ok: boolean;
    game_id: string;
    mlb_game_pk: number;
    status: string;
    completed: number;
    captured: string[];
    errors: string[];
  }> {
    const started = Date.now();
    this.inFlight += 1;
    const captured: string[] = [];
    const errors: string[] = [];

    try {
      const game = await this.prisma.game.findUnique({ where: { id: gameId } });
      if (!game) throw new NotFoundException('Game not found');

      await this.games.refreshLive(game.mlbGamePk);
      const fresh = await this.prisma.game.findUnique({ where: { id: gameId } });
      if (!fresh) throw new NotFoundException('Game not found');

      try {
        await this.weather.syncGame(gameId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`weather: ${msg}`);
        await this.logEvent({
          gameId,
          mlbGamePk: fresh.mlbGamePk,
          job: 'weather_sync',
          status: 'error',
          message: msg,
        });
      }

      const snaps = await this.prisma.f5OddsSnapshot.findMany({
        where: { gameId },
        select: { stage: true, locked: true, ok: true, fetchedAt: true },
      });

      const due = stagesNeedingFreshCapture({
        status: fresh.status,
        inning: fresh.inning,
        gameDateUtc: fresh.gameDateUtc,
        snapshots: snaps,
      });

      for (const stage of due) {
        try {
          const result = await this.odds.captureF5Stage(gameId, stage, {
            requireMarkets: false,
          });
          const row = result as {
            ok: boolean;
            winline_flipped?: boolean;
            skipped?: boolean;
            skip_reason?: string;
          };
          captured.push(stage);
          await this.logEvent({
            gameId,
            mlbGamePk: fresh.mlbGamePk,
            job: 'f5_capture',
            status: row.ok ? 'ok' : 'skipped',
            message: `stage=${stage} ok=${row.ok} flip=${row.winline_flipped} fresh=true`,
            meta: {
              stage,
              ok: row.ok,
              flipped: row.winline_flipped,
              skipped: row.skipped ?? false,
              skip_reason: row.skip_reason ?? null,
            },
            durationMs: Date.now() - started,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${stage}: ${msg}`);
          await this.logEvent({
            gameId,
            mlbGamePk: fresh.mlbGamePk,
            job: 'f5_capture',
            status: 'error',
            message: `stage=${stage} ${msg}`,
            meta: { stage },
            durationMs: Date.now() - started,
          });
        }
      }

      try {
        await this.context.refresh(gameId);
        await this.logEvent({
          gameId,
          mlbGamePk: fresh.mlbGamePk,
          job: 'context_refresh',
          status: 'ok',
          message: 'preview+features synced',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`context_refresh: ${msg}`);
        await this.logEvent({
          gameId,
          mlbGamePk: fresh.mlbGamePk,
          job: 'context_refresh',
          status: 'error',
          message: msg,
        });
      }

      const completed = completedInnings(fresh.inning);
      await this.logEvent({
        gameId,
        mlbGamePk: fresh.mlbGamePk,
        job: 'tick_game',
        status: errors.length ? 'error' : 'ok',
        message: `status=${fresh.status} completed=${completed} due=[${due.join(',')}] captured=[${captured.join(',')}]`,
        meta: { due, captured, errors, status: fresh.status, completed },
        durationMs: Date.now() - started,
      });

      this.logger.log(
        `pipeline tick pk=${fresh.mlbGamePk} status=${fresh.status} completed=${completed} due=[${due.join(',')}] captured=[${captured.join(',')}]`,
      );

      return {
        ok: errors.length === 0,
        game_id: gameId,
        mlb_game_pk: fresh.mlbGamePk,
        status: fresh.status,
        completed,
        captured,
        errors,
      };
    } finally {
      this.inFlight = Math.max(0, this.inFlight - 1);
    }
  }

  async tickUniverse(reason: PipelineReason): Promise<{
    ok: boolean;
    reason: PipelineReason;
    processed: number;
    failed: number;
  }> {
    if (!this.isEnabled() && reason !== 'manual') {
      return { ok: true, reason, processed: 0, failed: 0 };
    }

    const started = Date.now();
    let processed = 0;
    let failed = 0;

    try {
      if (reason === 'slate' || reason === 'final_probe') {
        await this.runSlateSync();
        if (reason === 'final_probe' || reason === 'slate') {
          await this.runFinalProbe();
        }
        if (reason === 'slate') {
          await this.logEvent({
            job: 'slate',
            status: 'ok',
            message: 'slate sync done',
            durationMs: Date.now() - started,
          });
          return { ok: true, reason, processed: 1, failed: 0 };
        }
      }

      const gameIds = await this.universeGameIds(reason);
      for (const id of gameIds) {
        try {
          await this.tickGame(id);
          processed += 1;
        } catch (err) {
          failed += 1;
          this.logger.warn(
            `pipeline ${reason} game=${id}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }

      await this.logEvent({
        job: reason === 'manual' ? 'tick_game' : reason,
        status: failed ? 'error' : 'ok',
        message: `universe processed=${processed} failed=${failed}`,
        meta: { processed, failed },
        durationMs: Date.now() - started,
      });

      return { ok: failed === 0, reason, processed, failed };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.logEvent({
        job: reason,
        status: 'error',
        message: msg,
        durationMs: Date.now() - started,
      });
      throw err;
    }
  }

  /**
   * Refresh MLB live feed for every LIVE/OTHER game (scores/inning/outs).
   */
  async tickLiveScores(concurrency = 4): Promise<{
    refreshed: number;
    failed: number;
  }> {
    if (!this.isEnabled()) return { refreshed: 0, failed: 0 };

    const games = await this.prisma.game.findMany({
      where: { status: { in: ['LIVE', 'OTHER'] } },
      select: { id: true, mlbGamePk: true },
      take: 60,
      orderBy: { gameDateUtc: 'asc' },
    });

    let refreshed = 0;
    let failed = 0;
    let cursor = 0;

    const workers = Array.from(
      { length: Math.min(concurrency, Math.max(1, games.length)) },
      async () => {
        while (cursor < games.length) {
          const idx = cursor;
          cursor += 1;
          const g = games[idx];
          if (!g) break;
          try {
            await this.games.refreshLive(g.mlbGamePk);
            refreshed += 1;
          } catch (err) {
            failed += 1;
            this.logger.warn(
              `live_scores game=${g.id}: ${err instanceof Error ? err.message : err}`,
            );
          }
        }
      },
    );

    await Promise.all(workers);

    if (games.length > 0) {
      await this.logEvent({
        job: 'live_scores',
        status: failed ? 'error' : 'ok',
        message: `live_scores refreshed=${refreshed} failed=${failed} total=${games.length}`,
        meta: { refreshed, failed, total: games.length },
      });
    }

    return { refreshed, failed };
  }

  /**
   * Refresh Savant/context for PREVIEW/LIVE games in the near window
   * so lineups/SP stay current (no betting recalc).
   */
  async tickContextRecalc(): Promise<{ checked: number; changed: number }> {
    if (!this.isEnabled()) return { checked: 0, changed: 0 };

    const now = Date.now();
    const from = new Date(now - 18 * 60 * 60 * 1000);
    const to = new Date(now + 6 * 60 * 60 * 1000);

    const games = await this.prisma.game.findMany({
      where: {
        status: { in: ['PREVIEW', 'LIVE', 'OTHER'] },
        gameDateUtc: { gte: from, lte: to },
      },
      select: { id: true, mlbGamePk: true },
      take: 80,
      orderBy: { gameDateUtc: 'asc' },
    });

    let changed = 0;
    for (const g of games) {
      try {
        await this.context.refresh(g.id);
        changed += 1;
        await this.logEvent({
          gameId: g.id,
          mlbGamePk: g.mlbGamePk,
          job: 'context_recalc',
          status: 'ok',
          message: 'context refreshed',
        });
      } catch (err) {
        await this.logEvent({
          gameId: g.id,
          mlbGamePk: g.mlbGamePk,
          job: 'context_recalc',
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { checked: games.length, changed };
  }

  async getStatus() {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await this.prisma.pipelineEvent.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });

    const openStages = await this.countOpenStageGames();

    return {
      ok: true,
      enabled: this.isEnabled(),
      in_flight: this.inFlight,
      open_stage_games: openStages,
      events_1h: recent.length,
      recent: recent.map((e) => ({
        id: e.id,
        job: e.job,
        status: e.status,
        message: e.message,
        mlb_game_pk: e.mlbGamePk,
        game_id: e.gameId,
        duration_ms: e.durationMs,
        created_at: e.createdAt.toISOString(),
      })),
    };
  }

  private async runSlateSync() {
    const today = mlbScheduleDateKey();
    const yesterday = mlbScheduleDateKey(
      new Date(Date.now() - 24 * 60 * 60 * 1000),
    );
    await this.sync.syncDates([today, yesterday]);
  }

  /** Refresh live feed for recently finished games (scores only — no settle). */
  private async runFinalProbe() {
    const now = Date.now();
    const windowStart = new Date(now - 12 * 60 * 60 * 1000);
    const windowEnd = new Date(now + 2 * 60 * 60 * 1000);
    const games = await this.prisma.game.findMany({
      where: {
        gameDateUtc: { gte: windowStart, lte: windowEnd },
        OR: [{ status: 'FINAL' }, { inning: { gte: 6 } }],
      },
      select: { id: true, mlbGamePk: true, status: true, inning: true },
      take: 40,
    });

    for (const g of games) {
      try {
        await this.games.refreshLive(g.mlbGamePk);
        await this.logEvent({
          gameId: g.id,
          mlbGamePk: g.mlbGamePk,
          job: 'f5_window_done',
          status: 'ok',
          message: `live refreshed status=${g.status} inning=${g.inning}`,
          meta: { status: g.status, inning: g.inning },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.logEvent({
          gameId: g.id,
          mlbGamePk: g.mlbGamePk,
          job: 'f5_window_done',
          status: 'error',
          message: msg,
        });
      }
    }
  }

  private async universeGameIds(reason: PipelineReason): Promise<string[]> {
    const now = Date.now();

    if (reason === 'prematch') {
      const from = new Date(now - 30 * 60 * 1000);
      const to = new Date(now + 60 * 60 * 1000);
      const games = await this.prisma.game.findMany({
        where: {
          status: 'PREVIEW',
          gameDateUtc: { gte: from, lte: to },
        },
        include: {
          f5OddsSnapshots: {
            select: { stage: true, locked: true, ok: true, fetchedAt: true },
          },
        },
      });
      return games
        .filter((g) => {
          if (!inPrematchWindow(g.gameDateUtc)) return false;
          const due = stagesNeedingFreshCapture({
            status: g.status,
            inning: g.inning,
            gameDateUtc: g.gameDateUtc,
            snapshots: g.f5OddsSnapshots,
          });
          return due.includes('prematch');
        })
        .map((g) => g.id);
    }

    if (reason === 'stage_watch' || reason === 'manual') {
      const from = new Date(now - 12 * 60 * 60 * 1000);
      const to = new Date(now + 12 * 60 * 60 * 1000);
      const games = await this.prisma.game.findMany({
        where: {
          status: { in: ['LIVE', 'OTHER'] },
          gameDateUtc: { gte: from, lte: to },
        },
        include: {
          f5OddsSnapshots: {
            select: { stage: true, locked: true, ok: true, fetchedAt: true },
          },
        },
      });
      return games
        .filter((g) =>
          needsStageWatch({
            status: g.status,
            snapshots: g.f5OddsSnapshots,
          }),
        )
        .map((g) => g.id);
    }

    return [];
  }

  private async countOpenStageGames(): Promise<number> {
    const from = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const to = new Date(Date.now() + 12 * 60 * 60 * 1000);
    const games = await this.prisma.game.findMany({
      where: {
        status: { in: ['LIVE', 'OTHER'] },
        gameDateUtc: { gte: from, lte: to },
      },
      include: {
        f5OddsSnapshots: {
          select: { stage: true, locked: true, ok: true, fetchedAt: true },
        },
      },
    });
    return games.filter((g) =>
      needsStageWatch({ status: g.status, snapshots: g.f5OddsSnapshots }),
    ).length;
  }

  private async logEvent(opts: {
    gameId?: string;
    mlbGamePk?: number;
    job: string;
    status: string;
    message?: string;
    meta?: Record<string, unknown>;
    durationMs?: number;
  }) {
    try {
      await this.prisma.pipelineEvent.create({
        data: {
          gameId: opts.gameId,
          mlbGamePk: opts.mlbGamePk,
          job: opts.job,
          status: opts.status,
          message: opts.message,
          metaJson: (opts.meta ?? undefined) as Prisma.InputJsonValue | undefined,
          durationMs: opts.durationMs,
        },
      });
    } catch (err) {
      this.logger.warn(
        `pipeline log failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
