import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  MlbStatsClient,
  normalizeGameStatus,
  type MlbScheduleGame,
} from './mlb-stats.client.js';

export type ScheduleSyncResult = {
  dates: string[];
  gamesUpserted: number;
};

@Injectable()
export class GamesSyncService {
  private readonly logger = new Logger(GamesSyncService.name);
  private readonly mlb = new MlbStatsClient();

  constructor(private readonly prisma: PrismaService) {}

  async syncDates(dates: string[]): Promise<ScheduleSyncResult> {
    let gamesUpserted = 0;

    for (const date of dates) {
      const payload = await this.mlb.fetchSchedule(date);
      const games = payload.dates?.[0]?.games ?? [];
      for (const game of games) {
        const ok = await this.upsertScheduleGame(game);
        if (ok) gamesUpserted += 1;
      }
      this.logger.log(`Schedule sync ${date}: ${games.length} games`);
    }

    return { dates, gamesUpserted };
  }

  private async upsertScheduleGame(game: MlbScheduleGame): Promise<boolean> {
    const homeTeamRaw = game.teams?.home?.team;
    const awayTeamRaw = game.teams?.away?.team;
    if (!homeTeamRaw?.id || !awayTeamRaw?.id || !game.gamePk || !game.gameDate) {
      return false;
    }

    const detailed = (game.status?.detailedState ?? '').toLowerCase();
    if (
      detailed.includes('postponed') &&
      (game.rescheduleDate || game.rescheduleGameDate)
    ) {
      this.logger.debug(
        `Skip postponed ghost pk=${game.gamePk} → ${game.rescheduleDate ?? game.rescheduleGameDate}`,
      );
      return false;
    }

    const homeTeam = await this.upsertTeam(homeTeamRaw);
    const awayTeam = await this.upsertTeam(awayTeamRaw);
    const venue = game.venue?.id
      ? await this.upsertVenue({
          id: game.venue.id,
          name: game.venue.name ?? `Venue ${game.venue.id}`,
        })
      : null;

    const status = normalizeGameStatus(
      game.status?.abstractGameState,
      game.status?.detailedState,
    );
    const nextStart = new Date(game.gameDate);

    const existing = await this.prisma.game.findUnique({
      where: { mlbGamePk: game.gamePk },
      select: { id: true, gameDateUtc: true },
    });

    await this.prisma.game.upsert({
      where: { mlbGamePk: game.gamePk },
      create: {
        mlbGamePk: game.gamePk,
        season: game.season ? Number(game.season) : null,
        gameDateUtc: nextStart,
        officialDate: new Date(`${game.officialDate}T00:00:00.000Z`),
        status,
        statusDetail: game.status?.detailedState ?? null,
        homeScore: game.teams?.home?.score ?? null,
        awayScore: game.teams?.away?.score ?? null,
        dayNight: game.dayNight ?? null,
        scheduledInnings: game.scheduledInnings ?? null,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        venueId: venue?.id ?? null,
        homeProbableMlbId: game.teams?.home?.probablePitcher?.id ?? null,
        awayProbableMlbId: game.teams?.away?.probablePitcher?.id ?? null,
        fetchedAt: new Date(),
        sourceUpdatedAt: new Date(),
      },
      update: {
        season: game.season ? Number(game.season) : null,
        gameDateUtc: nextStart,
        officialDate: new Date(`${game.officialDate}T00:00:00.000Z`),
        status,
        statusDetail: game.status?.detailedState ?? null,
        homeScore: game.teams?.home?.score ?? null,
        awayScore: game.teams?.away?.score ?? null,
        dayNight: game.dayNight ?? null,
        scheduledInnings: game.scheduledInnings ?? null,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        venueId: venue?.id ?? null,
        homeProbableMlbId: game.teams?.home?.probablePitcher?.id ?? null,
        awayProbableMlbId: game.teams?.away?.probablePitcher?.id ?? null,
        inning: status === 'PREVIEW' ? null : undefined,
        inningHalf: status === 'PREVIEW' ? null : undefined,
        inningState: status === 'PREVIEW' ? null : undefined,
        balls: status === 'PREVIEW' ? null : undefined,
        strikes: status === 'PREVIEW' ? null : undefined,
        outs: status === 'PREVIEW' ? null : undefined,
        fetchedAt: new Date(),
        sourceUpdatedAt: new Date(),
      },
    });

    // PPD → makeup keeps gameId; wipe stale TG fingerprint so T−60 re-alerts.
    if (
      existing &&
      Math.abs(existing.gameDateUtc.getTime() - nextStart.getTime()) > 60_000
    ) {
      await this.prisma.telegramNotifyState.deleteMany({
        where: { gameId: existing.id },
      });
      this.logger.log(
        `Cleared telegram notify state after reschedule pk=${game.gamePk}`,
      );
    }

    return true;
  }

  private async upsertTeam(team: {
    id: number;
    name: string;
    abbreviation?: string;
    teamName?: string;
    locationName?: string;
  }) {
    return this.prisma.team.upsert({
      where: { mlbTeamId: team.id },
      create: {
        mlbTeamId: team.id,
        name: team.name,
        abbreviation: team.abbreviation ?? String(team.id),
        teamName: team.teamName ?? null,
        locationName: team.locationName ?? null,
      },
      update: {
        name: team.name,
        abbreviation: team.abbreviation ?? String(team.id),
        teamName: team.teamName ?? null,
        locationName: team.locationName ?? null,
      },
    });
  }

  private async upsertVenue(venue: { id: number; name: string }) {
    return this.prisma.venue.upsert({
      where: { mlbVenueId: venue.id },
      create: {
        mlbVenueId: venue.id,
        name: venue.name,
      },
      update: {
        name: venue.name,
      },
    });
  }
}
