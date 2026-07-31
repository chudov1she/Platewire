import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { resolveStartingPitcherId } from '../formula/matchup-inputs.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SavantPreviewSummary } from '../savant/savant.client.js';
import { SavantPreviewService } from '../savant/savant-preview.service.js';
import type { PlayerRole } from './mlb-people.client.js';
import { OfficialFeaturesService } from './official-features.service.js';
import { PlayerFeaturesService } from './player-features.service.js';
import { UmpRollupService } from './ump-rollup.service.js';
import {
  UmpScorecardsService,
  type UmpScorecardView,
} from './ump-scorecards.service.js';

@Injectable()
export class ContextService {
  private readonly logger = new Logger(ContextService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: PlayerFeaturesService,
    private readonly preview: SavantPreviewService,
    private readonly officials: OfficialFeaturesService,
    private readonly umpRollup: UmpRollupService,
    private readonly umpScorecards: UmpScorecardsService,
  ) {}

  async getForGame(gameId: string, opts: { autoSync?: boolean } = {}) {
    const game = await this.prisma.game.findUnique({ where: { id: gameId } });
    if (!game) throw new NotFoundException('Game not found');

    let snapshot = await this.prisma.savantPreviewSnapshot.findUnique({
      where: { gameId },
    });
    if (opts.autoSync && !snapshot) {
      await this.preview.syncByMlbGamePk(game.mlbGamePk);
      snapshot = await this.prisma.savantPreviewSnapshot.findUnique({
        where: { gameId },
      });
    }

    if (opts.autoSync) {
      await this.syncUniverse(gameId, false);
      try {
        const officialsSync = await this.officials.syncGameOfficials(
          game.mlbGamePk,
          gameId,
        );
        // Historical HP profile is needed pre-game for readiness / decisions —
        // do not wait until FINAL.
        if (officialsSync.homePlateId) {
          await this.umpRollup.rollupOfficial(officialsSync.homePlateId);
        }
        await this.umpScorecards.ensureFresh(false).catch((err) => {
          this.logger.warn(
            `umpscorecards: ${err instanceof Error ? err.message : err}`,
          );
        });
      } catch (err) {
        this.logger.warn(
          `officials sync ${game.mlbGamePk}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return this.buildPack(gameId, game.mlbGamePk);
  }

  async refresh(gameId: string) {
    const game = await this.prisma.game.findUnique({ where: { id: gameId } });
    if (!game) throw new NotFoundException('Game not found');

    const preview = await this.preview.syncByMlbGamePk(game.mlbGamePk);
    const sync = await this.syncUniverse(gameId, true);
    let officialsSync: { count: number; homePlateId: number | null } = {
      count: 0,
      homePlateId: null,
    };
    try {
      officialsSync = await this.officials.syncGameOfficials(
        game.mlbGamePk,
        gameId,
      );
      // Roll up historical Home Plate profile even for PREVIEW/LIVE —
      // ump rates are an input to the formula before first pitch.
      if (officialsSync.homePlateId) {
        await this.umpRollup.rollupOfficial(officialsSync.homePlateId);
      }
      await this.umpScorecards.ensureFresh(false).catch((err) => {
        this.logger.warn(
          `umpscorecards refresh: ${err instanceof Error ? err.message : err}`,
        );
      });
    } catch (err) {
      this.logger.warn(
        `officials refresh ${game.mlbGamePk}: ${err instanceof Error ? err.message : err}`,
      );
    }
    const pack = await this.buildPack(gameId, game.mlbGamePk);
    return {
      ...pack,
      sync: { preview, players: sync, officials: officialsSync },
    };
  }

  async getPlayerFeatures(mlbPlayerId: number, opts: { sync?: boolean } = {}) {
    if (opts.sync) {
      await this.features.syncPlayer(mlbPlayerId, 'hitter', false);
      await this.features.syncPlayer(mlbPlayerId, 'pitcher', false);
    }
    const player = await this.features.getFeatures(mlbPlayerId);
    if (!player) throw new NotFoundException('Player not found');
    return {
      ok: true,
      player: {
        id: player.id,
        mlb_player_id: player.mlbPlayerId,
        full_name: player.fullName,
        bat_side: player.batSide,
        pitch_hand: player.pitchHand,
        primary_position: player.primaryPosition,
      },
      features: player.features.map((f) => serializeFeature(f)),
    };
  }

  async getOfficialFeatures(
    mlbOfficialId: number,
    opts: { sync?: boolean } = {},
  ) {
    if (opts.sync) {
      await this.umpRollup.rollupOfficial(mlbOfficialId);
      await this.umpScorecards.ensureFresh(false).catch((err) => {
        this.logger.warn(
          `umpscorecards: ${err instanceof Error ? err.message : err}`,
        );
      });
    }
    const official = await this.prisma.official.findUnique({
      where: { mlbOfficialId },
      include: { features: true },
    });
    if (!official) throw new NotFoundException('Official not found');
    const scorecard = await this.umpScorecards.resolveForOfficial({
      umpScorecardName: official.umpScorecardName,
      fullName: official.fullName,
    });
    if (scorecard && !official.umpScorecardName) {
      await this.prisma.official.update({
        where: { id: official.id },
        data: { umpScorecardName: scorecard.umpire_name },
      });
    }
    return {
      ok: true,
      id: official.id,
      mlb_official_id: official.mlbOfficialId,
      full_name: official.fullName,
      bio_fetched_at: official.bioFetchedAt?.toISOString() ?? null,
      feature: serializeOfficialFeature(official.features, scorecard),
    };
  }

  private async syncUniverse(gameId: string, force: boolean) {
    const targets = await this.collectUniverse(gameId);
    const results: Array<{
      mlb_player_id: number;
      role: PlayerRole;
      skipped: boolean;
      ready: boolean;
    }> = [];

    for (const t of targets) {
      try {
        const r = await this.features.syncPlayer(t.mlbPlayerId, t.role, force);
        results.push({
          mlb_player_id: t.mlbPlayerId,
          role: t.role,
          skipped: r.skipped,
          ready: r.ready,
        });
      } catch (err) {
        this.logger.warn(
          `sync ${t.mlbPlayerId}/${t.role}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return { count: results.length, results };
  }

  private async collectUniverse(
    gameId: string,
  ): Promise<Array<{ mlbPlayerId: number; role: PlayerRole }>> {
    const out: Array<{ mlbPlayerId: number; role: PlayerRole }> = [];
    const seen = new Set<string>();

    const lineup = await this.prisma.gameLineupPlayer.findMany({
      where: { gameId },
    });
    for (const row of lineup) {
      if (row.mlbPlayerId == null) continue;
      const key = `${row.mlbPlayerId}:hitter`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ mlbPlayerId: row.mlbPlayerId, role: 'hitter' });
    }

    const snapshot = await this.prisma.savantPreviewSnapshot.findUnique({
      where: { gameId },
    });
    const summary = (snapshot?.summaryJson ??
      null) as SavantPreviewSummary | null;
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: { homeProbableMlbId: true, awayProbableMlbId: true },
    });

    const spIds = [
      resolveStartingPitcherId(
        game?.homeProbableMlbId,
        summary?.home?.pitchers,
      ),
      resolveStartingPitcherId(
        game?.awayProbableMlbId,
        summary?.away?.pitchers,
      ),
    ].filter((id): id is number => id != null);

    for (const mlbPlayerId of spIds) {
      const key = `${mlbPlayerId}:pitcher`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ mlbPlayerId, role: 'pitcher' });
    }

    // Also refresh a couple of roster pitchers for preview UI — never instead of SP.
    for (const side of ['home', 'away'] as const) {
      const pitchers = (summary?.[side]?.pitchers ?? []).slice(0, 2);
      for (const p of pitchers) {
        if (p.mlb_player_id == null) continue;
        const key = `${p.mlb_player_id}:pitcher`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ mlbPlayerId: p.mlb_player_id, role: 'pitcher' });
      }
    }

    return out;
  }

  private async buildPack(gameId: string, mlbGamePk: number) {
    const season = new Date().getUTCFullYear();
    const snapshot = await this.prisma.savantPreviewSnapshot.findUnique({
      where: { gameId },
    });
    const summary = (snapshot?.summaryJson ??
      null) as SavantPreviewSummary | null;

    const lineupRows = await this.prisma.gameLineupPlayer.findMany({
      where: { gameId },
      orderBy: [{ side: 'asc' }, { battingOrder: 'asc' }],
    });

    const featureByKey = new Map<string, ReturnType<typeof serializeFeature>>();
    const mlbIds = [
      ...new Set(
        [
          ...lineupRows.map((r) => r.mlbPlayerId),
          ...(summary?.home?.pitchers ?? []).map((p) => p.mlb_player_id),
          ...(summary?.away?.pitchers ?? []).map((p) => p.mlb_player_id),
        ].filter((id): id is number => id != null),
      ),
    ];

    if (mlbIds.length) {
      const players = await this.prisma.player.findMany({
        where: { mlbPlayerId: { in: mlbIds } },
        include: {
          features: { where: { season } },
        },
      });
      for (const p of players) {
        for (const f of p.features) {
          featureByKey.set(`${p.mlbPlayerId}:${f.role}`, serializeFeature(f));
        }
      }
    }

    const packSide = (side: 'home' | 'away') => {
      const lineup = lineupRows
        .filter((r) => r.side === side)
        .map((r) => ({
          batting_order: r.battingOrder,
          mlb_player_id: r.mlbPlayerId,
          full_name: r.fullName,
          xwoba: r.xwoba,
          xslg: r.xslg,
          xba: r.xba,
          barrel_batted_rate: r.barrelRate,
          hard_hit_percent: r.hardHitPct,
          feature:
            r.mlbPlayerId != null
              ? (featureByKey.get(`${r.mlbPlayerId}:hitter`) ?? null)
              : null,
        }));

      const savantSp = summary?.[side]?.pitchers?.[0] ?? null;
      const starter = savantSp
        ? {
            mlb_player_id: savantSp.mlb_player_id,
            full_name: savantSp.full_name,
            savant: {
              era: savantSp.era,
              whip: savantSp.whip,
              xwoba: savantSp.xwoba,
              games_started: savantSp.games_started,
              ff_avg_speed: savantSp.ff_avg_speed,
            },
            feature:
              savantSp.mlb_player_id != null
                ? (featureByKey.get(`${savantSp.mlb_player_id}:pitcher`) ??
                  null)
                : null,
          }
        : null;

      return { lineup, starter };
    };

    const gameOfficials = await this.prisma.gameOfficial.findMany({
      where: { gameId },
      include: {
        official: { include: { features: true } },
      },
      orderBy: { role: 'asc' },
    });
    const hp = gameOfficials.find((o) => o.role === 'Home Plate') ?? null;
    const hpScorecard = hp
      ? await this.umpScorecards.resolveForOfficial({
          umpScorecardName: hp.official.umpScorecardName,
          fullName: hp.official.fullName,
        })
      : null;

    return {
      ok: true,
      game_id: gameId,
      mlb_game_pk: mlbGamePk,
      has_lineup: snapshot?.hasLineup ?? false,
      has_probable: snapshot?.hasProbable ?? false,
      home: packSide('home'),
      away: packSide('away'),
      home_plate_umpire: hp
        ? {
            mlb_official_id: hp.official.mlbOfficialId,
            full_name: hp.official.fullName,
            feature: serializeOfficialFeature(hp.official.features, hpScorecard),
          }
        : null,
      officials: gameOfficials.map((o) => ({
        role: o.role,
        mlb_official_id: o.official.mlbOfficialId,
        full_name: o.official.fullName,
      })),
    };
  }
}

function serializeFeature(f: {
  role: string;
  season: number;
  ready: boolean;
  gamesSample: number;
  asOf: Date | null;
  source: string;
  seasonOps: number | null;
  seasonAvg: number | null;
  seasonObp: number | null;
  seasonSlg: number | null;
  seasonEra: number | null;
  seasonWhip: number | null;
  seasonIp: number | null;
  seasonGames: number | null;
  seasonGamesStarted: number | null;
  l5Ops: number | null;
  l5Avg: number | null;
  l5Era: number | null;
  l5Whip: number | null;
  l5Ip: number | null;
  l5Games: number;
  l10Ops: number | null;
  l10Avg: number | null;
  l10Era: number | null;
  l10Whip: number | null;
  l10Ip: number | null;
  l10Games: number;
  fetchedAt: Date;
}) {
  return {
    role: f.role,
    season: f.season,
    ready: f.ready,
    games_sample: f.gamesSample,
    as_of: f.asOf?.toISOString().slice(0, 10) ?? null,
    source: f.source,
    season_ops: f.seasonOps,
    season_avg: f.seasonAvg,
    season_obp: f.seasonObp,
    season_slg: f.seasonSlg,
    season_era: f.seasonEra,
    season_whip: f.seasonWhip,
    season_ip: f.seasonIp,
    season_games: f.seasonGames,
    season_games_started: f.seasonGamesStarted,
    l5_ops: f.l5Ops,
    l5_avg: f.l5Avg,
    l5_era: f.l5Era,
    l5_whip: f.l5Whip,
    l5_ip: f.l5Ip,
    l5_games: f.l5Games,
    l10_ops: f.l10Ops,
    l10_avg: f.l10Avg,
    l10_era: f.l10Era,
    l10_whip: f.l10Whip,
    l10_ip: f.l10Ip,
    l10_games: f.l10Games,
    fetched_at: f.fetchedAt.toISOString(),
  };
}

function serializeOfficialFeature(
  feature:
    | {
        ready: boolean;
        gamesSample: number;
        asOf: Date | null;
        source: string;
        kRate: number | null;
        bbRate: number | null;
        calledStrikeRate: number | null;
        calledBallRate: number | null;
        fetchedAt: Date;
      }
    | null
    | undefined,
  scorecard?: UmpScorecardView | null,
) {
  if (!feature && !scorecard) return null;
  return {
    ready: feature?.ready ?? false,
    games_sample: feature?.gamesSample ?? 0,
    as_of: feature?.asOf?.toISOString().slice(0, 10) ?? null,
    source: feature?.source ?? (scorecard ? 'umpscorecards' : 'unknown'),
    k_rate: feature?.kRate ?? null,
    bb_rate: feature?.bbRate ?? null,
    called_strike_rate: feature?.calledStrikeRate ?? null,
    called_ball_rate: feature?.calledBallRate ?? null,
    fetched_at: feature?.fetchedAt.toISOString() ?? scorecard?.fetched_at ?? null,
    scorecard: scorecard ?? null,
  };
}
