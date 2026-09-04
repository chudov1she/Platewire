import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OfficialFeaturesService } from '../context/official-features.service.js';
import { UmpRollupService } from '../context/ump-rollup.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { mlbScheduleDateKey } from '../common/time.js';
import { GamesSyncService } from './games-sync.service.js';
import {
  MlbStatsClient,
  normalizeGameStatus,
} from './mlb-stats.client.js';

const gameInclude = {
  homeTeam: true,
  awayTeam: true,
  venue: true,
  savantPreview: { select: { hasLineup: true, hasProbable: true } },
  f5OddsSnapshots: { select: { stage: true, ok: true } },
  weatherObservations: { select: { id: true }, take: 1 },
} as const;

@Injectable()
export class GamesService {
  private readonly logger = new Logger(GamesService.name);
  private readonly mlb = new MlbStatsClient();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: GamesSyncService,
    private readonly officials: OfficialFeaturesService,
    private readonly umpRollup: UmpRollupService,
  ) {}

  async listByDate(date: string, opts: { autoSync?: boolean } = {}) {
    const officialDate = new Date(`${date}T00:00:00.000Z`);
    let games = await this.prisma.game.findMany({
      where: { officialDate },
      include: gameInclude,
      orderBy: { gameDateUtc: 'asc' },
    });

    if (opts.autoSync && games.length === 0) {
      await this.sync.syncDates([date]);
      games = await this.prisma.game.findMany({
        where: { officialDate },
        include: gameInclude,
        orderBy: { gameDateUtc: 'asc' },
      });
    }

    return {
      ok: true,
      date,
      count: games.length,
      games: games.map((g) => this.serializeGame(g)),
    };
  }

  async listToday() {
    const date = mlbScheduleDateKey();
    return this.listByDate(date, { autoSync: true });
  }

  async syncDate(date?: string) {
    const target = date || mlbScheduleDateKey();
    const result = await this.sync.syncDates([target]);
    const slate = await this.listByDate(target);
    return { ...result, ...slate };
  }

  async getById(id: string, opts: { refresh?: boolean } = {}) {
    if (opts.refresh) {
      const existing = await this.prisma.game.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Game not found');
      await this.refreshLive(existing.mlbGamePk);
    }

    const game = await this.prisma.game.findUnique({
      where: { id },
      include: gameInclude,
    });
    if (!game) throw new NotFoundException('Game not found');
    return { ok: true, game: this.serializeGame(game) };
  }

  async refreshLive(mlbGamePk: number): Promise<{ status: string }> {
    const feed = await this.mlb.fetchLiveFeed(mlbGamePk);
    const status = normalizeGameStatus(
      feed.gameData?.status?.abstractGameState,
      feed.gameData?.status?.detailedState,
    );
    const linescore = feed.liveData?.linescore;
    const weather = feed.gameData?.weather;
    const venueData = feed.gameData?.venue;

    const existing = await this.prisma.game.findUnique({
      where: { mlbGamePk },
    });
    if (!existing) {
      this.logger.warn(`Live refresh skipped, game ${mlbGamePk} not in DB`);
      return { status: 'MISSING' };
    }

    let venueId = existing.venueId;
    if (venueData?.id) {
      const location = venueData.location;
      const coords = location?.defaultCoordinates;
      const venue = await this.prisma.venue.upsert({
        where: { mlbVenueId: venueData.id },
        create: {
          mlbVenueId: venueData.id,
          name: venueData.name ?? `Venue ${venueData.id}`,
          city: location?.city ?? null,
          state: location?.state ?? null,
          country: location?.country ?? null,
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
        },
        update: {
          name: venueData.name ?? `Venue ${venueData.id}`,
          city: location?.city ?? null,
          state: location?.state ?? null,
          country: location?.country ?? null,
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
        },
      });
      venueId = venue.id;
    }

    const isPreview = status === 'PREVIEW';
    await this.prisma.game.update({
      where: { mlbGamePk },
      data: {
        status,
        statusDetail: feed.gameData?.status?.detailedState ?? null,
        homeScore: isPreview
          ? (linescore?.teams?.home?.runs ?? existing.homeScore ?? 0)
          : (linescore?.teams?.home?.runs ?? existing.homeScore),
        awayScore: isPreview
          ? (linescore?.teams?.away?.runs ?? existing.awayScore ?? 0)
          : (linescore?.teams?.away?.runs ?? existing.awayScore),
        inning: isPreview ? null : (linescore?.currentInning ?? null),
        inningHalf: isPreview ? null : (linescore?.inningHalf ?? null),
        inningState: isPreview ? null : (linescore?.inningState ?? null),
        balls: isPreview ? null : (linescore?.balls ?? null),
        strikes: isPreview ? null : (linescore?.strikes ?? null),
        outs: isPreview ? null : (linescore?.outs ?? null),
        weatherCondition: weather?.condition ?? existing.weatherCondition,
        weatherTemp: weather?.temp ?? existing.weatherTemp,
        weatherWind: weather?.wind ?? existing.weatherWind,
        homeProbableMlbId:
          feed.gameData?.probablePitchers?.home?.id ??
          existing.homeProbableMlbId,
        awayProbableMlbId:
          feed.gameData?.probablePitchers?.away?.id ??
          existing.awayProbableMlbId,
        venueId,
        fetchedAt: new Date(),
        sourceUpdatedAt: new Date(),
      },
    });

    try {
      const officialsResult = await this.officials.applyFromFeed(
        mlbGamePk,
        existing.id,
        feed,
      );
      if (status === 'FINAL' && officialsResult.homePlateId) {
        await this.umpRollup.rollupOfficial(officialsResult.homePlateId);
      }
    } catch (err) {
      this.logger.warn(
        `officials live ${mlbGamePk}: ${err instanceof Error ? err.message : err}`,
      );
    }

    return { status };
  }

  serializeGame(game: {
    id: string;
    mlbGamePk: number;
    season: number | null;
    gameDateUtc: Date;
    officialDate: Date;
    status: string;
    statusDetail: string | null;
    homeScore: number | null;
    awayScore: number | null;
    inning: number | null;
    inningHalf: string | null;
    inningState: string | null;
    balls: number | null;
    strikes: number | null;
    outs: number | null;
    dayNight: string | null;
    scheduledInnings: number | null;
    weatherCondition: string | null;
    weatherTemp: string | null;
    weatherWind: string | null;
    winlineEventId: number | null;
    winlineFlipped: boolean | null;
    fetchedAt: Date | null;
    homeProbableMlbId?: number | null;
    awayProbableMlbId?: number | null;
    homeTeam: {
      id: string;
      mlbTeamId: number;
      name: string;
      abbreviation: string;
      teamName: string | null;
      locationName: string | null;
    };
    awayTeam: {
      id: string;
      mlbTeamId: number;
      name: string;
      abbreviation: string;
      teamName: string | null;
      locationName: string | null;
    };
    venue: {
      id: string;
      mlbVenueId: number;
      name: string;
      city: string | null;
      state: string | null;
      country: string | null;
      latitude: number | null;
      longitude: number | null;
    } | null;
    savantPreview?: { hasLineup: boolean; hasProbable: boolean } | null;
    f5OddsSnapshots?: Array<{ stage: string; ok: boolean }>;
    weatherObservations?: Array<{ id: string }>;
  }) {
    const odds = { prematch: false, inn1: false, inn2: false };
    for (const snap of game.f5OddsSnapshots ?? []) {
      if (!snap.ok) continue;
      if (snap.stage === 'prematch') odds.prematch = true;
      if (snap.stage === 'inn1') odds.inn1 = true;
      if (snap.stage === 'inn2') odds.inn2 = true;
    }

    return {
      id: game.id,
      mlb_game_pk: game.mlbGamePk,
      season: game.season,
      game_date_utc: game.gameDateUtc.toISOString(),
      official_date: game.officialDate.toISOString().slice(0, 10),
      status: game.status,
      status_detail: game.statusDetail,
      home_score: game.homeScore,
      away_score: game.awayScore,
      inning: game.inning,
      inning_half: game.inningHalf,
      inning_state: game.inningState,
      balls: game.balls,
      strikes: game.strikes,
      outs: game.outs,
      day_night: game.dayNight,
      scheduled_innings: game.scheduledInnings,
      weather_condition: game.weatherCondition,
      weather_temp: game.weatherTemp,
      weather_wind: game.weatherWind,
      winline_event_id: game.winlineEventId,
      winline_flipped: game.winlineFlipped,
      fetched_at: game.fetchedAt?.toISOString() ?? null,
      completeness: {
        has_lineup: game.savantPreview?.hasLineup === true,
        has_home_sp:
          game.homeProbableMlbId != null ||
          game.savantPreview?.hasProbable === true,
        has_away_sp:
          game.awayProbableMlbId != null ||
          game.savantPreview?.hasProbable === true,
        has_odds: odds,
        weather_ready:
          (game.weatherObservations?.length ?? 0) > 0 ||
          Boolean(game.weatherTemp),
      },
      home_team: {
        id: game.homeTeam.id,
        mlb_team_id: game.homeTeam.mlbTeamId,
        name: game.homeTeam.name,
        abbreviation: game.homeTeam.abbreviation,
        team_name: game.homeTeam.teamName,
        location_name: game.homeTeam.locationName,
      },
      away_team: {
        id: game.awayTeam.id,
        mlb_team_id: game.awayTeam.mlbTeamId,
        name: game.awayTeam.name,
        abbreviation: game.awayTeam.abbreviation,
        team_name: game.awayTeam.teamName,
        location_name: game.awayTeam.locationName,
      },
      venue: game.venue
        ? {
            id: game.venue.id,
            mlb_venue_id: game.venue.mlbVenueId,
            name: game.venue.name,
            city: game.venue.city,
            state: game.venue.state,
            country: game.venue.country,
            latitude: game.venue.latitude,
            longitude: game.venue.longitude,
          }
        : null,
    };
  }
}
