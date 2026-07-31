import { Injectable, NotFoundException } from '@nestjs/common';
import { UmpRollupService } from '../context/ump-rollup.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SavantPreviewSummary } from './savant.client.js';
import { SavantGamefeedService } from './savant-gamefeed.service.js';
import { SavantPreviewService } from './savant-preview.service.js';
import { SavantStatcastService } from './savant-statcast.service.js';

export type SavantLayer = 'preview' | 'gamefeed' | 'statcast';

@Injectable()
export class SavantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preview: SavantPreviewService,
    private readonly gamefeed: SavantGamefeedService,
    private readonly statcast: SavantStatcastService,
    private readonly umpRollup: UmpRollupService,
  ) {}

  async getForGame(
    gameId: string,
    opts: { autoFetch?: boolean } = {},
  ) {
    const game = await this.prisma.game.findUnique({ where: { id: gameId } });
    if (!game) throw new NotFoundException('Game not found');

    let snapshot = await this.prisma.savantPreviewSnapshot.findUnique({
      where: { gameId },
    });

    if (opts.autoFetch && !snapshot) {
      const result = await this.preview.syncByMlbGamePk(game.mlbGamePk);
      if (result.error) {
        return {
          ok: false,
          game_id: gameId,
          mlb_game_pk: game.mlbGamePk,
          error: result.error,
          has_lineup: false,
          has_probable: false,
          fetched_at: null,
          home: emptySide(),
          away: emptySide(),
          gamefeed: null,
        };
      }
      snapshot = await this.prisma.savantPreviewSnapshot.findUnique({
        where: { gameId },
      });
    }

    const lineupRows = await this.prisma.gameLineupPlayer.findMany({
      where: { gameId },
      orderBy: [{ side: 'asc' }, { battingOrder: 'asc' }],
    });

    const summary = (snapshot?.summaryJson ?? null) as SavantPreviewSummary | null;
    const homePitchers = summary?.home?.pitchers ?? [];
    const awayPitchers = summary?.away?.pitchers ?? [];

    const gamefeedSnap = await this.prisma.savantGamefeedSnapshot.findUnique({
      where: { gameId },
    });

    return {
      ok: true,
      game_id: gameId,
      mlb_game_pk: game.mlbGamePk,
      has_lineup: snapshot?.hasLineup ?? false,
      has_probable: snapshot?.hasProbable ?? false,
      fetched_at: snapshot?.fetchedAt?.toISOString() ?? null,
      home: {
        lineup: lineupRows
          .filter((r) => r.side === 'home')
          .map((r) => serializeLineupRow(r)),
        pitchers: homePitchers,
      },
      away: {
        lineup: lineupRows
          .filter((r) => r.side === 'away')
          .map((r) => serializeLineupRow(r)),
        pitchers: awayPitchers,
      },
      gamefeed: gamefeedSnap
        ? {
            game_status: gamefeedSnap.gameStatus,
            game_status_code: gamefeedSnap.gameStatusCode,
            fetched_at: gamefeedSnap.fetchedAt.toISOString(),
            scoreboard: gamefeedSnap.scoreboardJson,
            stats: gamefeedSnap.statsJson,
            current_play: gamefeedSnap.currentPlayJson,
            top_performers: gamefeedSnap.topPerformersJson,
          }
        : null,
    };
  }

  async refresh(
    gameId: string,
    layers: SavantLayer[] = ['preview', 'gamefeed'],
  ) {
    const game = await this.prisma.game.findUnique({ where: { id: gameId } });
    if (!game) throw new NotFoundException('Game not found');

    const sync: Record<string, unknown> = {};
    if (layers.includes('preview')) {
      sync.preview = await this.preview.syncByMlbGamePk(game.mlbGamePk);
    }
    if (layers.includes('gamefeed')) {
      sync.gamefeed = await this.gamefeed.syncByMlbGamePk(game.mlbGamePk);
    }
    if (layers.includes('statcast')) {
      sync.statcast = await this.statcast.syncByMlbGamePk(game.mlbGamePk);
      if (game.status === 'FINAL') {
        await this.umpRollup.rollupHomePlateForGame(gameId);
      }
    }

    const payload = await this.getForGame(gameId);
    return { ...payload, sync };
  }

  async getStatcast(
    gameId: string,
    opts: { limit?: number; offset?: number; autoFetch?: boolean } = {},
  ) {
    const game = await this.prisma.game.findUnique({ where: { id: gameId } });
    if (!game) throw new NotFoundException('Game not found');

    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 2000);
    const offset = Math.max(opts.offset ?? 0, 0);

    let total = await this.prisma.statcastPitch.count({ where: { gameId } });
    let sync = null;
    if (opts.autoFetch && total === 0) {
      sync = await this.statcast.syncByMlbGamePk(game.mlbGamePk);
      total = await this.prisma.statcastPitch.count({ where: { gameId } });
      if (game.status === 'FINAL' && sync && !sync.error && sync.rowsUpserted > 0) {
        await this.umpRollup.rollupHomePlateForGame(gameId);
      }
    }

    const rows = await this.prisma.statcastPitch.findMany({
      where: { gameId },
      orderBy: [{ atBatNumber: 'asc' }, { pitchNumber: 'asc' }],
      skip: offset,
      take: limit,
    });

    return {
      ok: true,
      game_id: gameId,
      mlb_game_pk: game.mlbGamePk,
      total,
      limit,
      offset,
      sync,
      pitches: rows.map((p) => ({
        at_bat_number: p.atBatNumber,
        pitch_number: p.pitchNumber,
        batter_mlb_id: p.sourceBatterId,
        pitcher_mlb_id: p.sourcePitcherId,
        pitch_type: p.pitchType,
        pitch_name: p.pitchName,
        events: p.events,
        description: p.description,
        inning: p.inning,
        inning_half: p.inningHalf,
        balls: p.balls,
        strikes: p.strikes,
        outs: p.outs,
        release_speed: p.releaseSpeed,
        launch_speed: p.launchSpeed,
        launch_angle: p.launchAngle,
        estimated_ba: p.estimatedBa,
        estimated_woba: p.estimatedWoba,
        estimated_slg: p.estimatedSlg,
        bat_speed: p.batSpeed,
        fetched_at: p.fetchedAt.toISOString(),
      })),
    };
  }

  async getPlayer(mlbPlayerId: number) {
    const player = await this.prisma.player.findUnique({
      where: { mlbPlayerId },
    });
    if (!player) throw new NotFoundException('Player not found');

    const slots = await this.prisma.gameLineupPlayer.findMany({
      where: { mlbPlayerId },
      orderBy: { id: 'desc' },
      take: 20,
      include: {
        game: {
          select: {
            id: true,
            mlbGamePk: true,
            officialDate: true,
            status: true,
            gameDateUtc: true,
          },
        },
      },
    });

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
      recent_lineup_slots: slots.map((s) => ({
        game_id: s.gameId,
        mlb_game_pk: s.game.mlbGamePk,
        official_date: s.game.officialDate.toISOString().slice(0, 10),
        game_status: s.game.status,
        side: s.side,
        batting_order: s.battingOrder,
        xwoba: s.xwoba,
        xslg: s.xslg,
        xba: s.xba,
        barrel_rate: s.barrelRate,
        hard_hit_pct: s.hardHitPct,
      })),
    };
  }
}

function serializeLineupRow(r: {
  side: string;
  battingOrder: number;
  mlbPlayerId: number | null;
  fullName: string | null;
  xwoba: number | null;
  xslg: number | null;
  xba: number | null;
  barrelRate: number | null;
  hardHitPct: number | null;
}) {
  return {
    side: r.side,
    batting_order: r.battingOrder,
    mlb_player_id: r.mlbPlayerId,
    full_name: r.fullName,
    xwoba: r.xwoba,
    xslg: r.xslg,
    xba: r.xba,
    barrel_batted_rate: r.barrelRate,
    hard_hit_percent: r.hardHitPct,
  };
}

function emptySide() {
  return { lineup: [] as unknown[], pitchers: [] as unknown[] };
}
