import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { STARTING_BANKROLL_POINTS } from '../ai/stake-sizing.js';

@Injectable()
export class LedgerAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(opts: {
    track?: string;
    status?: string;
    action?: string;
    limit?: number;
  }) {
    const take = Math.min(200, Math.max(1, opts.limit ?? 50));
    const rows = await this.prisma.f5LedgerEntry.findMany({
      where: {
        ...(opts.track ? { track: opts.track } : {}),
        ...(opts.status ? { resultStatus: opts.status } : {}),
        ...(opts.action ? { action: opts.action } : {}),
      },
      include: {
        game: { include: { homeTeam: true, awayTeam: true } },
        formulaVersion: { select: { versionLabel: true } },
      },
      orderBy: { capturedAt: 'desc' },
      take,
    });
    return rows.map((r) => this.serialize(r));
  }

  async getOne(id: string) {
    const row = await this.prisma.f5LedgerEntry.findUnique({
      where: { id },
      include: {
        game: { include: { homeTeam: true, awayTeam: true } },
        formulaVersion: { select: { versionLabel: true } },
        aiTrace: true,
      },
    });
    if (!row) return null;
    return {
      ...this.serialize(row),
      aiTrace: row.aiTrace
        ? {
            id: row.aiTrace.id,
            model: row.aiTrace.model,
            latencyMs: row.aiTrace.latencyMs,
            promptJson: row.aiTrace.promptJson,
            rawOutputJson: row.aiTrace.rawOutputJson,
            createdAt: row.aiTrace.createdAt.toISOString(),
          }
        : null,
    };
  }

  async setExcludedFromStats(id: string, excludedFromStats: boolean) {
    const row = await this.prisma.f5LedgerEntry.update({
      where: { id },
      data: { excludedFromStats },
      include: {
        game: { include: { homeTeam: true, awayTeam: true } },
        formulaVersion: { select: { versionLabel: true } },
      },
    });
    return this.serialize(row);
  }

  async stats(days = 7, track?: string) {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - Math.max(1, days));
    const rows = await this.prisma.f5LedgerEntry.findMany({
      where: {
        capturedAt: { gte: since },
        excludedFromStats: false,
        ...(track ? { track } : {}),
      },
    });

    const decided = rows.filter((r) =>
      ['win', 'loss', 'push'].includes(r.resultStatus),
    );
    const wins = decided.filter((r) => r.resultStatus === 'win').length;
    const losses = decided.filter((r) => r.resultStatus === 'loss').length;
    const pushes = decided.filter((r) => r.resultStatus === 'push').length;
    const pending = rows.filter((r) => r.resultStatus === 'pending').length;
    const passed = rows.filter((r) => r.action === 'pass').length;
    const profit = decided.reduce((s, r) => s + (r.profitUnits ?? 0), 0);
    const staked = decided.reduce((s, r) => s + (r.stakeUnits ?? 0), 0);
    const roi = staked > 0 ? (profit / staked) * 100 : 0;

    const byTrack: Record<string, { n: number; profit: number }> = {};
    const byConfidence: Record<string, { n: number; profit: number }> = {};
    for (const r of decided) {
      const t = byTrack[r.track] ?? { n: 0, profit: 0 };
      t.n += 1;
      t.profit += r.profitUnits ?? 0;
      byTrack[r.track] = t;

      const cKey = r.confidenceTier ?? 'unknown';
      const c = byConfidence[cKey] ?? { n: 0, profit: 0 };
      c.n += 1;
      c.profit += r.profitUnits ?? 0;
      byConfidence[cKey] = c;
    }

    const worst = [...decided]
      .filter((r) => (r.profitUnits ?? 0) < 0)
      .sort((a, b) => (a.profitUnits ?? 0) - (b.profitUnits ?? 0))
      .slice(0, 5)
      .map((r) => ({
        gameId: r.gameId,
        track: r.track,
        pickMarket: r.pickMarket,
        pickSide: r.pickSide,
        profitUnits: r.profitUnits,
        resultStatus: r.resultStatus,
      }));

    return {
      days,
      track: track ?? null,
      total: rows.length,
      pending,
      passed,
      wins,
      losses,
      pushes,
      winrate: wins + losses > 0 ? wins / (wins + losses) : null,
      profitUnits: Math.round(profit * 100) / 100,
      stakedUnits: staked,
      roiPct: Math.round(roi * 10) / 10,
      byTrack,
      byConfidence,
      worstLosses: worst,
      startingBankroll: STARTING_BANKROLL_POINTS,
    };
  }

  /**
   * Chronological equity curve: one point per settled bet (action=bet),
   * accumulating profitUnits from STARTING_BANKROLL_POINTS.
   */
  async equityCurve(limit = 500, track?: string) {
    const rows = await this.prisma.f5LedgerEntry.findMany({
      where: {
        action: 'bet',
        excludedFromStats: false,
        resultStatus: { in: ['win', 'loss', 'push'] },
        ...(track ? { track } : {}),
      },
      orderBy: [{ settledAt: 'asc' }, { capturedAt: 'asc' }],
      take: Math.min(2000, Math.max(1, limit)),
      include: {
        game: { include: { homeTeam: true, awayTeam: true } },
      },
    });

    let bank = STARTING_BANKROLL_POINTS;
    const points = rows.map((r, index) => {
      const profit = r.profitUnits ?? 0;
      bank += profit;
      const away = r.game.awayTeam.abbreviation;
      const home = r.game.homeTeam.abbreviation;
      return {
        id: r.id,
        n: index + 1,
        settledAt: r.settledAt?.toISOString() ?? null,
        matchup: `${away} @ ${home}`,
        track: r.track,
        pickLabel: pickLabelForEntry({
          action: r.action,
          market: r.pickMarket,
          side: r.pickSide,
          line: r.pickLine,
          awayAbbr: away,
          homeAbbr: home,
        }),
        profitUnits: Math.round(profit * 100) / 100,
        resultStatus: r.resultStatus,
        bank: Math.round(bank * 100) / 100,
      };
    });

    return {
      startingBankroll: STARTING_BANKROLL_POINTS,
      track: track ?? null,
      points,
    };
  }

  private serialize(row: {
    id: string;
    gameId: string;
    track: string;
    action: string;
    pickMarket: string | null;
    pickSide: string | null;
    pickLine: number | null;
    decimalOdds: number | null;
    valuePct: number | null;
    roiPct: number | null;
    confidenceTier: string | null;
    stakeUnits: number | null;
    resultStatus: string;
    profitUnits: number | null;
    excludedFromStats?: boolean;
    f5HomeRuns?: number | null;
    f5AwayRuns?: number | null;
    riskFlags: string[];
    rationale: string | null;
    notifyBrief?: string | null;
    captureReason?: string | null;
    capturedAt: Date;
    settledAt: Date | null;
    game: {
      homeTeam: { abbreviation: string };
      awayTeam: { abbreviation: string };
      gameDateUtc?: Date;
    };
    formulaVersion: { versionLabel: string };
  }) {
    const away = row.game.awayTeam.abbreviation;
    const home = row.game.homeTeam.abbreviation;
    return {
      id: row.id,
      gameId: row.gameId,
      matchup: `${away} @ ${home}`,
      track: row.track,
      action: row.action,
      pickMarket: row.pickMarket,
      pickSide: row.pickSide,
      pickLine: row.pickLine,
      pickLabel: pickLabelForEntry({
        action: row.action,
        market: row.pickMarket,
        side: row.pickSide,
        line: row.pickLine,
        awayAbbr: away,
        homeAbbr: home,
      }),
      decimalOdds: row.decimalOdds,
      valuePct: row.valuePct,
      roiPct: row.roiPct,
      confidenceTier: row.confidenceTier,
      stakeUnits: row.stakeUnits,
      resultStatus: row.resultStatus,
      profitUnits: row.profitUnits,
      excludedFromStats: row.excludedFromStats ?? false,
      f5HomeRuns: row.f5HomeRuns ?? null,
      f5AwayRuns: row.f5AwayRuns ?? null,
      riskFlags: row.riskFlags,
      rationale: row.rationale,
      notifyBrief: row.notifyBrief ?? null,
      captureReason: row.captureReason ?? null,
      versionLabel: row.formulaVersion.versionLabel,
      gameDateUtc: row.game.gameDateUtc?.toISOString() ?? null,
      capturedAt: row.capturedAt.toISOString(),
      settledAt: row.settledAt?.toISOString() ?? null,
    };
  }
}

/** Human pick string for journal UI (mirrors betting-spider marketLabel). */
export function pickLabelForEntry(opts: {
  action: string;
  market: string | null;
  side: string | null;
  line: number | null;
  awayAbbr: string;
  homeAbbr: string;
}): string | null {
  if (opts.action === 'pass') return null;
  const market = opts.market?.toLowerCase() ?? '';
  const side = opts.side?.toLowerCase() ?? '';
  if (!market || !side) return null;
  if (market === 'moneyline') {
    if (side === 'home') return `${opts.homeAbbr} ML`;
    if (side === 'away') return `${opts.awayAbbr} ML`;
    if (side === 'draw') return 'F5 Draw';
  }
  if (market === 'total') {
    const ln = opts.line ?? 4.5;
    return side === 'over' ? `Over ${ln}` : `Under ${ln}`;
  }
  if (market === 'team_total') {
    const encoded = /^(home|away)_(over|under)$/.exec(side);
    const team = encoded?.[1] ?? '';
    const ou = encoded?.[2] ?? side;
    const abbr = team === 'away' ? opts.awayAbbr : opts.homeAbbr;
    const ln = opts.line ?? 2;
    return `${abbr} ${ou === 'under' ? 'Under' : 'Over'} ${ln}`;
  }
  if (market === 'runline' || market === 'handicap') {
    const ln = opts.line ?? -1.5;
    const team = side === 'home' ? opts.homeAbbr : opts.awayAbbr;
    return `${team} ${ln > 0 ? '+' : ''}${ln}`;
  }
  return `${opts.market} ${opts.side}`;
}
