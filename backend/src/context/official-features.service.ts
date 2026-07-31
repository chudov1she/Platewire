import { Injectable, Logger } from '@nestjs/common';
import { CONTEXT_OFFICIAL_BIO_TTL_MS } from '../common/context.constants.js';
import { Prisma } from '../generated/prisma/client.js';
import { MlbStatsClient } from '../games/mlb-stats.client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MlbPeopleClient } from './mlb-people.client.js';
import { normalizeOfficialRole } from './official-role.js';

type FeedOfficial = {
  official?: { id?: number; fullName?: string; link?: string };
  officialType?: string;
};

@Injectable()
export class OfficialFeaturesService {
  private readonly logger = new Logger(OfficialFeaturesService.name);
  private readonly people = new MlbPeopleClient();
  private readonly mlb = new MlbStatsClient();

  constructor(private readonly prisma: PrismaService) {}

  async syncGameOfficials(
    mlbGamePk: number,
    gameId: string,
  ): Promise<{ count: number; homePlateId: number | null }> {
    const feed = await this.mlb.fetchLiveFeed(mlbGamePk);
    return this.applyFromFeed(mlbGamePk, gameId, feed);
  }

  async applyFromFeed(
    mlbGamePk: number,
    gameId: string,
    feed: unknown,
  ): Promise<{ count: number; homePlateId: number | null }> {
    const officials = extractOfficials(feed);
    const fetchedAt = new Date();
    let homePlateId: number | null = null;

    for (const row of officials) {
      const mlbOfficialId = row.official?.id;
      if (!mlbOfficialId) continue;
      const role = normalizeOfficialRole(row.officialType);
      if (!role) continue;

      const official = await this.upsertOfficial(
        mlbOfficialId,
        row.official?.fullName ?? null,
        fetchedAt,
      );

      await this.prisma.gameOfficial.upsert({
        where: {
          gameId_role: { gameId, role },
        },
        create: {
          gameId,
          officialId: official.id,
          role,
          fetchedAt,
        },
        update: {
          officialId: official.id,
          fetchedAt,
        },
      });

      if (role === 'Home Plate') {
        homePlateId = mlbOfficialId;
      }
    }

    this.logger.debug(
      `Officials ${mlbGamePk}: ${officials.length} hp=${homePlateId}`,
    );
    return { count: officials.length, homePlateId };
  }

  private async upsertOfficial(
    mlbOfficialId: number,
    fullName: string | null,
    fetchedAt: Date,
  ) {
    const existing = await this.prisma.official.findUnique({
      where: { mlbOfficialId },
    });

    const needsBio =
      !existing?.bioFetchedAt ||
      Date.now() - existing.bioFetchedAt.getTime() >
        CONTEXT_OFFICIAL_BIO_TTL_MS;

    let bioJson: Prisma.InputJsonValue | undefined;
    let name = fullName ?? existing?.fullName ?? null;
    if (needsBio) {
      try {
        const person = await this.people.fetchPersonBio(mlbOfficialId);
        if (person) {
          bioJson = person as unknown as Prisma.InputJsonValue;
          name = person.fullName ?? name;
        }
      } catch (error) {
        this.logger.debug(
          `Official bio ${mlbOfficialId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return this.prisma.official.upsert({
      where: { mlbOfficialId },
      create: {
        mlbOfficialId,
        fullName: name,
        bioJson,
        bioFetchedAt: bioJson ? fetchedAt : null,
      },
      update: {
        fullName: name ?? undefined,
        ...(bioJson ? { bioJson, bioFetchedAt: fetchedAt } : {}),
      },
    });
  }
}

function extractOfficials(feed: unknown): FeedOfficial[] {
  const data = feed as {
    liveData?: { boxscore?: { officials?: FeedOfficial[] } };
    gameData?: { officials?: FeedOfficial[] };
  };
  return (
    data.liveData?.boxscore?.officials ??
    data.gameData?.officials ??
    []
  );
}
