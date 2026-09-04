import { Injectable, NotFoundException } from '@nestjs/common';
import { ContextService } from '../context/context.service.js';
import { GamesService } from '../games/games.service.js';
import { OddsService } from '../odds/odds.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WeatherSyncService } from '../weather/weather-sync.service.js';
import { MatchupInputsService } from './matchup-inputs.service.js';

/**
 * Assembles a read-only Game Pack from collected facts for external consumers
 * (e.g. Hermes). Does not run formula, decide bets, or write ledger.
 */
@Injectable()
export class GamePackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly games: GamesService,
    private readonly context: ContextService,
    private readonly weather: WeatherSyncService,
    private readonly odds: OddsService,
    private readonly matchup: MatchupInputsService,
  ) {}

  async getPack(gameId: string) {
    const gameRow = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        homeTeam: true,
        awayTeam: true,
        venue: true,
        savantPreview: { select: { fetchedAt: true, hasLineup: true, hasProbable: true } },
        f5OddsSnapshots: {
          select: { stage: true, locked: true, ok: true, fetchedAt: true },
        },
        weatherObservations: {
          select: { capturedAt: true, relativeToGame: true },
          orderBy: { capturedAt: 'desc' },
          take: 1,
        },
        gameOfficials: {
          where: { role: 'Home Plate' },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!gameRow) throw new NotFoundException('Game not found');

    const [{ game }, context, weather, oddsTracks, features] = await Promise.all([
      this.games.getById(gameId),
      this.context.getForGame(gameId, { autoSync: false }),
      this.weather.listForGame(gameId, { autoFetch: false }),
      this.loadOddsTracks(gameId),
      this.matchup.build(gameId),
    ]);

    const hasOdds = {
      prematch: Boolean(oddsTracks.prematch?.ok),
      inn1: Boolean(oddsTracks.inn1?.ok),
      inn2: Boolean(oddsTracks.inn2?.ok),
    };

    const weatherReady =
      weather.count > 0 ||
      Boolean(gameRow.weatherTemp) ||
      features.input_sources.temperature_f?.source === 'open_meteo' ||
      features.input_sources.temperature_f?.source === 'mlb_weather';

    const umpReady =
      features.input_sources.ump_accuracy_above_x?.ready === true ||
      features.input_sources.ump_strike_zone_pct?.source === 'feature';

    return {
      ok: true,
      game,
      home: context.home,
      away: context.away,
      venue: game.venue,
      weather: {
        summary: weather.summary,
        observations: weather.observations,
        mlb: {
          condition: game.weather_condition,
          temp: game.weather_temp,
          wind: game.weather_wind,
        },
      },
      umpire: {
        home_plate: context.home_plate_umpire,
        officials: context.officials,
      },
      odds: {
        tracks: oddsTracks,
      },
      features: {
        inputs: features.inputs,
        input_sources: features.input_sources,
        notes: features.notes,
        context: features.context,
      },
      completeness: {
        has_lineup: features.context.hasLineup,
        has_home_sp: features.context.hasHomeSp,
        has_away_sp: features.context.hasAwaySp,
        has_odds: hasOdds,
        weather_ready: weatherReady,
        ump_ready: umpReady,
      },
      as_of: {
        game_fetched_at: game.fetched_at,
        savant_preview_at: gameRow.savantPreview?.fetchedAt?.toISOString() ?? null,
        weather_captured_at:
          gameRow.weatherObservations[0]?.capturedAt?.toISOString() ?? null,
        odds: {
          prematch: oddsTracks.prematch?.captured_at ?? null,
          inn1: oddsTracks.inn1?.captured_at ?? null,
          inn2: oddsTracks.inn2?.captured_at ?? null,
        },
      },
    };
  }

  /** Lightweight completeness for slate lists (Hermes / UI). */
  async completenessByGameIds(gameIds: string[]) {
    if (!gameIds.length) return new Map<string, CompletenessFlags>();

    const [previews, snaps, weatherCounts, games] = await Promise.all([
      this.prisma.savantPreviewSnapshot.findMany({
        where: { gameId: { in: gameIds } },
        select: { gameId: true, hasLineup: true, hasProbable: true },
      }),
      this.prisma.f5OddsSnapshot.findMany({
        where: { gameId: { in: gameIds } },
        select: { gameId: true, stage: true, ok: true },
      }),
      this.prisma.weatherObservation.groupBy({
        by: ['gameId'],
        where: { gameId: { in: gameIds } },
        _count: { _all: true },
      }),
      this.prisma.game.findMany({
        where: { id: { in: gameIds } },
        select: {
          id: true,
          homeProbableMlbId: true,
          awayProbableMlbId: true,
          weatherTemp: true,
        },
      }),
    ]);

    const previewBy = new Map(previews.map((p) => [p.gameId, p]));
    const weatherBy = new Map(
      weatherCounts.map((w) => [w.gameId, w._count._all]),
    );
    const oddsBy = new Map<string, { prematch: boolean; inn1: boolean; inn2: boolean }>();
    for (const id of gameIds) {
      oddsBy.set(id, { prematch: false, inn1: false, inn2: false });
    }
    for (const s of snaps) {
      const cur = oddsBy.get(s.gameId);
      if (!cur || !s.ok) continue;
      if (s.stage === 'prematch') cur.prematch = true;
      if (s.stage === 'inn1') cur.inn1 = true;
      if (s.stage === 'inn2') cur.inn2 = true;
    }

    const out = new Map<string, CompletenessFlags>();
    for (const g of games) {
      const preview = previewBy.get(g.id);
      out.set(g.id, {
        has_lineup: preview?.hasLineup === true,
        has_home_sp: g.homeProbableMlbId != null || preview?.hasProbable === true,
        has_away_sp: g.awayProbableMlbId != null || preview?.hasProbable === true,
        has_odds: oddsBy.get(g.id) ?? { prematch: false, inn1: false, inn2: false },
        weather_ready: (weatherBy.get(g.id) ?? 0) > 0 || Boolean(g.weatherTemp),
      });
    }
    return out;
  }

  private async loadOddsTracks(gameId: string) {
    try {
      const payload = await this.odds.getLatestF5(gameId);
      if ('tracks' in payload) {
        return payload.tracks as {
          prematch: OddsTrack | null;
          inn1: OddsTrack | null;
          inn2: OddsTrack | null;
        };
      }
      return { prematch: null, inn1: null, inn2: null };
    } catch {
      return { prematch: null, inn1: null, inn2: null };
    }
  }
}

export type CompletenessFlags = {
  has_lineup: boolean;
  has_home_sp: boolean;
  has_away_sp: boolean;
  has_odds: { prematch: boolean; inn1: boolean; inn2: boolean };
  weather_ready: boolean;
};

type OddsTrack = {
  ok: boolean;
  captured_at: string;
  stage: string;
  locked: boolean;
  [key: string]: unknown;
};
