import { Injectable, Logger } from '@nestjs/common';
import { UMP_SCORECARDS_TTL_MS } from '../common/context.constants.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { matchUmpScorecardName, normalizeUmpName } from './ump-name.js';
import { UmpScorecardsClient } from './ump-scorecards.client.js';

export type UmpScorecardView = {
  umpire_name: string;
  games_sample: number;
  overall_accuracy: number | null;
  accuracy_above_x: number | null;
  consistency: number | null;
  favor_abs_mean: number | null;
  total_run_impact_mean: number | null;
  weighted_score: number | null;
  called_pitches: number | null;
  called_correct: number | null;
  called_wrong: number | null;
  source: 'umpscorecards';
  fetched_at: string;
  profile_url: string;
};

@Injectable()
export class UmpScorecardsService {
  private readonly logger = new Logger(UmpScorecardsService.name);
  private syncInFlight: Promise<{ upserted: number }> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: UmpScorecardsClient,
  ) {}

  async ensureFresh(force = false): Promise<{ upserted: number; skipped: boolean }> {
    if (!force) {
      const newest = await this.prisma.umpScorecardProfile.findFirst({
        orderBy: { fetchedAt: 'desc' },
        select: { fetchedAt: true },
      });
      if (
        newest &&
        Date.now() - newest.fetchedAt.getTime() < UMP_SCORECARDS_TTL_MS
      ) {
        // Catalog still fresh, but new GameOfficial rows appear every slate —
        // always re-link MLB names → UmpScorecards profiles.
        await this.relinkOfficials();
        return { upserted: 0, skipped: true };
      }
    }
    const result = await this.syncAll();
    return { ...result, skipped: false };
  }

  async syncAll(): Promise<{ upserted: number }> {
    if (this.syncInFlight) return this.syncInFlight;
    this.syncInFlight = this.runSync().finally(() => {
      this.syncInFlight = null;
    });
    return this.syncInFlight;
  }

  private async runSync(): Promise<{ upserted: number }> {
    const rows = await this.client.fetchUmpires();
    const fetchedAt = new Date();
    let upserted = 0;

    for (const row of rows) {
      const umpireName = row.umpire?.trim();
      if (!umpireName) continue;
      const nameKey = normalizeUmpName(umpireName);
      if (!nameKey) continue;

      const metricsJson = row as unknown as Prisma.InputJsonValue;
      // Upsert by normalized nameKey — API can list spelling variants that collide.
      await this.prisma.umpScorecardProfile.upsert({
        where: { nameKey },
        create: {
          umpireName,
          nameKey,
          gamesSample: row.n ?? 0,
          overallAccuracy: numOrNull(row.overall_accuracy_wmean),
          accuracyAboveX: numOrNull(row.accuracy_above_x_wmean),
          consistency: numOrNull(row.consistency_wmean),
          favorAbsMean: numOrNull(row.favor_abs_mean),
          totalRunImpactMean: numOrNull(row.total_run_impact_mean),
          weightedScore: numOrNull(row.weighted_score),
          calledPitches: intOrNull(row.called_pitches_sum),
          calledCorrect: intOrNull(row.called_correct_sum),
          calledWrong: intOrNull(row.called_wrong_sum),
          metricsJson,
          fetchedAt,
        },
        update: {
          umpireName,
          gamesSample: row.n ?? 0,
          overallAccuracy: numOrNull(row.overall_accuracy_wmean),
          accuracyAboveX: numOrNull(row.accuracy_above_x_wmean),
          consistency: numOrNull(row.consistency_wmean),
          favorAbsMean: numOrNull(row.favor_abs_mean),
          totalRunImpactMean: numOrNull(row.total_run_impact_mean),
          weightedScore: numOrNull(row.weighted_score),
          calledPitches: intOrNull(row.called_pitches_sum),
          calledCorrect: intOrNull(row.called_correct_sum),
          calledWrong: intOrNull(row.called_wrong_sum),
          metricsJson,
          fetchedAt,
        },
      });
      upserted += 1;
    }

    await this.relinkOfficials();
    this.logger.log(`umpscorecards sync upserted=${upserted}`);
    return { upserted };
  }

  /** Best-effort name link for all Officials missing/ stale scorecard name. */
  async relinkOfficials(): Promise<number> {
    const profiles = await this.prisma.umpScorecardProfile.findMany({
      select: { umpireName: true, nameKey: true },
    });
    if (!profiles.length) return 0;

    const officials = await this.prisma.official.findMany({
      select: { id: true, fullName: true, umpScorecardName: true },
    });
    let linked = 0;
    for (const o of officials) {
      const matched = matchUmpScorecardName(o.fullName, profiles);
      if (matched && matched !== o.umpScorecardName) {
        await this.prisma.official.update({
          where: { id: o.id },
          data: { umpScorecardName: matched },
        });
        linked += 1;
      } else if (!matched && o.umpScorecardName) {
        await this.prisma.official.update({
          where: { id: o.id },
          data: { umpScorecardName: null },
        });
      }
    }
    return linked;
  }

  async resolveForOfficial(opts: {
    umpScorecardName?: string | null;
    fullName?: string | null;
  }): Promise<UmpScorecardView | null> {
    let name = opts.umpScorecardName ?? null;
    if (!name && opts.fullName) {
      const profiles = await this.prisma.umpScorecardProfile.findMany({
        select: { umpireName: true, nameKey: true },
      });
      name = matchUmpScorecardName(opts.fullName, profiles);
    }
    if (!name) return null;

    const row = await this.prisma.umpScorecardProfile.findUnique({
      where: { umpireName: name },
    });
    if (!row) return null;
    return toView(row);
  }
}

function numOrNull(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}

function intOrNull(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.round(v);
}

function toView(row: {
  umpireName: string;
  gamesSample: number;
  overallAccuracy: number | null;
  accuracyAboveX: number | null;
  consistency: number | null;
  favorAbsMean: number | null;
  totalRunImpactMean: number | null;
  weightedScore: number | null;
  calledPitches: number | null;
  calledCorrect: number | null;
  calledWrong: number | null;
  fetchedAt: Date;
}): UmpScorecardView {
  return {
    umpire_name: row.umpireName,
    games_sample: row.gamesSample,
    overall_accuracy: row.overallAccuracy,
    accuracy_above_x: row.accuracyAboveX,
    consistency: row.consistency,
    favor_abs_mean: row.favorAbsMean,
    total_run_impact_mean: row.totalRunImpactMean,
    weighted_score: row.weightedScore,
    called_pitches: row.calledPitches,
    called_correct: row.calledCorrect,
    called_wrong: row.calledWrong,
    source: 'umpscorecards',
    fetched_at: row.fetchedAt.toISOString(),
    profile_url: `https://umpscorecards.com/data/single-umpire/${encodeURIComponent(row.umpireName)}`,
  };
}
