import { Injectable, Logger } from '@nestjs/common';
import {
  CONTEXT_HITTER_L5_MIN_GAMES,
  CONTEXT_PITCHER_L5_MIN_GAMES,
  CONTEXT_PLAYER_TTL_MS,
} from '../common/context.constants.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MlbPeopleClient, type PlayerRole } from './mlb-people.client.js';

@Injectable()
export class PlayerFeaturesService {
  private readonly logger = new Logger(PlayerFeaturesService.name);
  private readonly client = new MlbPeopleClient();

  constructor(private readonly prisma: PrismaService) {}

  async syncPlayer(
    mlbPlayerId: number,
    role: PlayerRole,
    force = false,
  ): Promise<{ skipped: boolean; ready: boolean }> {
    const season = new Date().getUTCFullYear();
    const player = await this.prisma.player.upsert({
      where: { mlbPlayerId },
      create: { mlbPlayerId },
      update: {},
    });

    if (!force) {
      const existing = await this.prisma.playerFeature.findUnique({
        where: {
          playerId_role_season: {
            playerId: player.id,
            role,
            season,
          },
        },
      });
      if (
        existing &&
        Date.now() - existing.fetchedAt.getTime() < CONTEXT_PLAYER_TTL_MS
      ) {
        return { skipped: true, ready: existing.ready };
      }
    }

    const people = await this.client.fetchPeopleBatch(
      [mlbPlayerId],
      role,
      season,
    );
    const person = people[0];
    if (!person) {
      this.logger.warn(`MLB person ${mlbPlayerId} not found`);
      return { skipped: false, ready: false };
    }

    const parsed = this.client.parsePersonStats(person, role);
    const fetchedAt = new Date();

    await this.prisma.player.update({
      where: { id: player.id },
      data: {
        fullName: person.fullName ?? undefined,
        batSide: person.batSide?.code ?? undefined,
        pitchHand: person.pitchHand?.code ?? undefined,
        primaryPosition: person.primaryPosition?.abbreviation ?? undefined,
        birthDate: person.birthDate ?? undefined,
        bioJson: person as unknown as Prisma.InputJsonValue,
        bioFetchedAt: fetchedAt,
      },
    });

    const seasonStat = parsed.season ?? {};
    const l5 = parsed.l5;
    const l10 = parsed.l10;
    const minGames =
      role === 'hitter'
        ? CONTEXT_HITTER_L5_MIN_GAMES
        : CONTEXT_PITCHER_L5_MIN_GAMES;
    const ready = l5.games >= minGames;
    const source = ready
      ? 'mlb_lastx'
      : seasonStat && Object.keys(seasonStat).length
        ? 'mlb_season'
        : 'mlb_lastx';

    const asOf = l5.asOf ? new Date(`${l5.asOf}T00:00:00.000Z`) : null;

    await this.prisma.playerFeature.upsert({
      where: {
        playerId_role_season: {
          playerId: player.id,
          role,
          season,
        },
      },
      create: {
        playerId: player.id,
        mlbPlayerId,
        role,
        season,
        ready,
        gamesSample: l5.games,
        asOf,
        source,
        seasonOps: num(seasonStat.ops),
        seasonAvg: num(seasonStat.avg),
        seasonObp: num(seasonStat.obp),
        seasonSlg: num(seasonStat.slg),
        seasonEra: num(seasonStat.era),
        seasonWhip: num(seasonStat.whip),
        seasonIp: num(seasonStat.inningsPitched),
        seasonGames: int(seasonStat.gamesPlayed ?? seasonStat.games),
        seasonGamesStarted: int(seasonStat.gamesStarted),
        l5Ops: l5.ops,
        l5Avg: l5.avg,
        l5Era: l5.era,
        l5Whip: l5.whip,
        l5Ip: l5.ip,
        l5Games: l5.games,
        l10Ops: l10.ops,
        l10Avg: l10.avg,
        l10Era: l10.era,
        l10Whip: l10.whip,
        l10Ip: l10.ip,
        l10Games: l10.games,
        metricsJson: {
          season: seasonStat,
          l5,
          l10,
        } as Prisma.InputJsonValue,
        fetchedAt,
      },
      update: {
        ready,
        gamesSample: l5.games,
        asOf,
        source,
        seasonOps: num(seasonStat.ops),
        seasonAvg: num(seasonStat.avg),
        seasonObp: num(seasonStat.obp),
        seasonSlg: num(seasonStat.slg),
        seasonEra: num(seasonStat.era),
        seasonWhip: num(seasonStat.whip),
        seasonIp: num(seasonStat.inningsPitched),
        seasonGames: int(seasonStat.gamesPlayed ?? seasonStat.games),
        seasonGamesStarted: int(seasonStat.gamesStarted),
        l5Ops: l5.ops,
        l5Avg: l5.avg,
        l5Era: l5.era,
        l5Whip: l5.whip,
        l5Ip: l5.ip,
        l5Games: l5.games,
        l10Ops: l10.ops,
        l10Avg: l10.avg,
        l10Era: l10.era,
        l10Whip: l10.whip,
        l10Ip: l10.ip,
        l10Games: l10.games,
        metricsJson: {
          season: seasonStat,
          l5,
          l10,
        } as Prisma.InputJsonValue,
        fetchedAt,
      },
    });

    this.logger.debug(
      `PlayerFeature ${mlbPlayerId}/${role}: ready=${ready} l5=${l5.games}`,
    );
    return { skipped: false, ready };
  }

  async getFeatures(mlbPlayerId: number) {
    const player = await this.prisma.player.findUnique({
      where: { mlbPlayerId },
      include: { features: { orderBy: [{ season: 'desc' }, { role: 'asc' }] } },
    });
    return player;
  }
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function int(value: unknown): number | null {
  const n = num(value);
  return n == null ? null : Math.trunc(n);
}
