import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { FormulaRunnerService } from '../formula/formula-runner.service.js';
import { FormulaStoreService } from '../formula/formula-store.service.js';
import { MatchupInputsService } from '../formula/matchup-inputs.service.js';
import { MarketLoaderService } from '../formula/market-loader.service.js';
import { normalizeFormulaSpec, patchFormulaSpec } from '../formula/formula-spec.js';
import type { FormulaSpec, ValueBet } from '../formula/formula.types.js';
import { profitForResult, settleBetResult, toLedgerStatus } from './f5-settle.js';

/**
 * Backtests a candidate FormulaSpec patch against real settled ledger rows.
 *
 * Both baseline and proposed metrics are computed by REPLAYING the same
 * historical games with the CURRENT PRODUCTION spec vs. the patched spec —
 * never against `defaultFormulaSpec()`. Comparing a patch to a stale,
 * unrelated default was a real bug in an earlier version of this system;
 * here baseline always means "what production actually does today".
 */
@Injectable()
export class LedgerBacktestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: FormulaStoreService,
    private readonly matchup: MatchupInputsService,
    private readonly markets: MarketLoaderService,
    private readonly runner: FormulaRunnerService,
  ) {}

  async comparePatch(
    patch: Record<string, unknown>,
    opts?: { days?: number; track?: string },
  ): Promise<{
    baseline: Record<string, number>;
    proposed: Record<string, number>;
    baselineVersionId: string;
    baselineVersionLabel: string;
    sample: number;
  }> {
    const production = await this.store.getProduction();
    const proposedSpec = patchFormulaSpec(production.spec, patch);
    return this.compareAgainstProduction(proposedSpec, {
      ...opts,
    });
  }

  /**
   * Replay settled ledger picks: production baseline vs an explicit candidate
   * (version id, inline spec, or patch on top of fromVersionId/production).
   */
  async compareCandidate(opts: {
    days?: number;
    track?: string;
    versionId?: string;
    spec?: unknown;
    patch?: Record<string, unknown>;
    fromVersionId?: string;
  }): Promise<{
    baseline: Record<string, number>;
    proposed: Record<string, number>;
    baselineVersionId: string;
    baselineVersionLabel: string;
    candidateLabel: string;
    candidateVersionId: string | null;
    resolvedSpec: FormulaSpec;
    sample: number;
  }> {
    const production = await this.store.getProduction();
    let proposedSpec = production.spec;
    let candidateLabel = production.versionLabel;
    let candidateVersionId: string | null = null;

    if (opts.versionId) {
      const version = await this.store.getVersion(opts.versionId);
      proposedSpec = version.spec;
      candidateLabel = version.versionLabel;
      candidateVersionId = version.id;
    } else if (opts.spec != null) {
      proposedSpec = normalizeFormulaSpec(opts.spec);
      candidateLabel = proposedSpec.version || 'inline-spec';
    } else if (opts.patch) {
      let baseSpec = production.spec;
      if (opts.fromVersionId) {
        const from = await this.store.getVersion(opts.fromVersionId);
        baseSpec = from.spec;
      }
      proposedSpec = patchFormulaSpec(baseSpec, opts.patch);
      candidateLabel = `${opts.fromVersionId ? 'from-version' : production.versionLabel}+patch`;
    } else {
      throw new NotFoundException(
        'Provide versionId, spec, or patch for formula backtest',
      );
    }

    const compared = await this.compareAgainstProduction(proposedSpec, {
      days: opts.days,
      track: opts.track,
    });
    return {
      ...compared,
      candidateLabel,
      candidateVersionId,
      resolvedSpec: proposedSpec,
    };
  }

  private async compareAgainstProduction(
    proposedSpec: FormulaSpec,
    opts?: { days?: number; track?: string },
  ): Promise<{
    baseline: Record<string, number>;
    proposed: Record<string, number>;
    baselineVersionId: string;
    baselineVersionLabel: string;
    sample: number;
  }> {
    const days = opts?.days ?? 14;
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);

    const rows = await this.prisma.f5LedgerEntry.findMany({
      where: {
        capturedAt: { gte: since },
        f5HomeRuns: { not: null },
        f5AwayRuns: { not: null },
        ...(opts?.track ? { track: opts.track } : {}),
      },
      take: 80,
      orderBy: { capturedAt: 'desc' },
    });

    const production = await this.store.getProduction();
    const baselineSpec = production.spec;

    const baseline = await this.metricsFor(rows, baselineSpec);
    const proposed = await this.metricsFor(rows, proposedSpec);
    return {
      baseline,
      proposed,
      baselineVersionId: production.versionId,
      baselineVersionLabel: production.versionLabel,
      sample: rows.length,
    };
  }

  private async metricsFor(
    rows: Array<{ gameId: string; track: string }>,
    spec: FormulaSpec,
  ): Promise<Record<string, number>> {
    let wins = 0;
    let losses = 0;
    let pushes = 0;
    let skipped = 0;
    let profit = 0;
    let staked = 0;

    for (const row of rows) {
      const replay = await this.replayPick(row.gameId, row.track, spec);
      if (!replay) {
        skipped += 1;
        continue;
      }

      const game = await this.prisma.game.findUnique({
        where: { id: row.gameId },
        select: { homeScore: true, awayScore: true },
      });
      const f5 = await this.prisma.f5LedgerEntry.findUnique({
        where: { gameId_track: { gameId: row.gameId, track: row.track } },
        select: { f5HomeRuns: true, f5AwayRuns: true },
      });
      const f5Home = f5?.f5HomeRuns ?? null;
      const f5Away = f5?.f5AwayRuns ?? null;
      if (f5Home == null || f5Away == null) {
        skipped += 1;
        continue;
      }
      void game;

      const result = settleBetResult({
        market: replay.market,
        side: replay.side,
        line: replay.line,
        f5Home,
        f5Away,
      });
      const status = toLedgerStatus(result);
      const stake = 50;
      const p = profitForResult(stake, replay.decimal_odds, result);
      if (status === 'win') wins += 1;
      else if (status === 'loss') losses += 1;
      else if (status === 'push') pushes += 1;
      else {
        skipped += 1;
        continue;
      }
      staked += stake;
      profit += p ?? 0;
    }

    const decided = wins + losses;
    return {
      wins,
      losses,
      pushes,
      skipped,
      profit: Math.round(profit * 100) / 100,
      roiPct: staked > 0 ? Math.round((profit / staked) * 1000) / 10 : 0,
      winrate: decided > 0 ? Math.round((wins / decided) * 1000) / 1000 : 0,
      n: wins + losses + pushes,
    };
  }

  private async replayPick(
    gameId: string,
    track: string,
    spec: FormulaSpec,
  ): Promise<ValueBet | null> {
    try {
      const built = await this.matchup.build(gameId);
      const marketLoad = await this.markets.load(gameId, track);
      const analysis = this.runner.analyze(
        built.inputs,
        marketLoad.markets,
        normalizeFormulaSpec(spec),
      );
      const pool = analysis.signals.length ? analysis.signals : analysis.value_bets;
      if (!pool.length) return null;
      return pool[0]!;
    } catch {
      return null;
    }
  }
}
