import { Injectable, Logger } from '@nestjs/common';
import { f5IsComplete } from '../odds/f5-scope.js';
import { MlbStatsClient } from '../games/mlb-stats.client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  extractF5RunsFromScoreboard,
  profitForResult,
  settleBetResult,
  toLedgerStatus,
} from './f5-settle.js';

/**
 * Closes the loop: turns a Decision-agent's paper stake into a factual
 * win/loss/push once the F5 (first-5-innings) score is known. Replaces the
 * old `f5_window_done` pipeline stub.
 */
@Injectable()
export class LedgerSettleService {
  private readonly logger = new Logger(LedgerSettleService.name);
  private readonly mlb = new MlbStatsClient();

  constructor(private readonly prisma: PrismaService) {}

  async settleGame(gameId: string): Promise<{ settled: number; skipped: number }> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: { savantGamefeed: true },
    });
    if (!game) return { settled: 0, skipped: 0 };

    const f5 = await this.resolveF5Runs({
      mlbGamePk: game.mlbGamePk,
      status: game.status,
      inning: game.inning,
      inningHalf: game.inningHalf,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      scoreboardJson: game.savantGamefeed?.scoreboardJson,
    });
    if (f5.home == null || f5.away == null) {
      return { settled: 0, skipped: 1 };
    }

    const pending = await this.prisma.f5LedgerEntry.findMany({
      where: { gameId, resultStatus: 'pending' },
    });

    let settled = 0;
    for (const row of pending) {
      if (row.action === 'pass') {
        // No money at risk, but we still record the F5 score for backtest
        // comparisons (did the AI correctly skip a losing signal?).
        await this.prisma.f5LedgerEntry.update({
          where: { id: row.id },
          data: {
            resultStatus: 'passed',
            f5HomeRuns: f5.home,
            f5AwayRuns: f5.away,
            profitUnits: 0,
            settledAt: new Date(),
          },
        });
        settled += 1;
        continue;
      }

      const result = settleBetResult({
        market: row.pickMarket,
        side: row.pickSide,
        line: row.pickLine,
        f5Home: f5.home,
        f5Away: f5.away,
      });
      if (result === 'PENDING') continue;
      const status = toLedgerStatus(result);
      const profit = profitForResult(row.stakeUnits, row.decimalOdds, result);
      await this.prisma.f5LedgerEntry.update({
        where: { id: row.id },
        data: {
          resultStatus: status,
          f5HomeRuns: f5.home,
          f5AwayRuns: f5.away,
          profitUnits: profit,
          settledAt: new Date(),
        },
      });
      settled += 1;
    }
    return { settled, skipped: pending.length - settled };
  }

  async settleBatch(limit = 50): Promise<{ games: number; settled: number }> {
    const candidates = await this.prisma.game.findMany({
      where: {
        ledgerEntries: { some: { resultStatus: 'pending' } },
      },
      take: limit,
      select: { id: true },
    });
    let settled = 0;
    for (const g of candidates) {
      const r = await this.settleGame(g.id);
      settled += r.settled;
    }
    return { games: candidates.length, settled };
  }

  /**
   * Resolve first-5 runs in priority order:
   * 1) Savant scoreboard linescore (if present)
   * 2) MLB StatsAPI live feed innings (works even after FINAL / inning 9)
   * 3) Early-6th fallback: current score ≈ F5 while still in the 6th
   */
  async resolveF5Runs(opts: {
    mlbGamePk: number;
    status: string;
    inning: number | null;
    inningHalf: string | null;
    homeScore: number | null;
    awayScore: number | null;
    scoreboardJson?: unknown;
  }): Promise<{ home: number | null; away: number | null; source: string }> {
    const fromBoard = extractF5RunsFromScoreboard(opts.scoreboardJson);
    if (fromBoard.home != null && fromBoard.away != null) {
      return { ...fromBoard, source: 'savant' };
    }

    try {
      const feed = await this.mlb.fetchLiveFeed(opts.mlbGamePk);
      const fromMlb = extractF5RunsFromScoreboard(feed.liveData?.linescore);
      if (fromMlb.home != null && fromMlb.away != null) {
        return { ...fromMlb, source: 'mlb_linescore' };
      }
    } catch (err) {
      this.logger.warn(
        `F5 MLB linescore pk=${opts.mlbGamePk}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Early 6th with no reliable linescore: current score ≈ F5 score.
    // Do NOT use final 9-inning totals — that would mis-settle F5 markets.
    if (
      f5IsComplete(opts.inning, opts.inningHalf) &&
      opts.inning === 6 &&
      opts.homeScore != null &&
      opts.awayScore != null
    ) {
      return { home: opts.homeScore, away: opts.awayScore, source: 'early_6th' };
    }

    return { home: null, away: null, source: 'none' };
  }
}

/** @deprecated Prefer LedgerSettleService.resolveF5Runs — kept for unit tests. */
export function extractF5Runs(opts: {
  inning: number | null;
  inningHalf: string | null;
  homeScore: number | null;
  awayScore: number | null;
  scoreboardJson?: unknown;
}): { home: number | null; away: number | null } {
  const fromBoard = extractF5RunsFromScoreboard(opts.scoreboardJson);
  if (fromBoard.home != null && fromBoard.away != null) return fromBoard;

  if (
    f5IsComplete(opts.inning, opts.inningHalf) &&
    opts.inning === 6 &&
    opts.homeScore != null &&
    opts.awayScore != null
  ) {
    return { home: opts.homeScore, away: opts.awayScore };
  }

  return { home: null, away: null };
}
