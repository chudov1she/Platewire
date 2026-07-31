import { Injectable, Logger } from '@nestjs/common';
import { CONTEXT_UMP_MIN_GAMES } from '../common/context.constants.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { computeUmpRates, round3 } from './ump-metrics.js';

@Injectable()
export class UmpRollupService {
  private readonly logger = new Logger(UmpRollupService.name);

  constructor(private readonly prisma: PrismaService) {}

  async rollupOfficial(mlbOfficialId: number): Promise<{
    ready: boolean;
    gamesSample: number;
  }> {
    const official = await this.prisma.official.findUnique({
      where: { mlbOfficialId },
    });
    if (!official) {
      return { ready: false, gamesSample: 0 };
    }

    const assignments = await this.prisma.gameOfficial.findMany({
      where: {
        officialId: official.id,
        role: 'Home Plate',
      },
      select: {
        gameId: true,
        game: { select: { officialDate: true, status: true } },
      },
    });

    const finalAssignments = assignments.filter(
      (a) => a.game.status === 'FINAL',
    );
    const gameIds = finalAssignments.map((a) => a.gameId);
    const gamesSample = gameIds.length;

    let rates = computeUmpRates([]);
    if (gameIds.length) {
      const rows = await this.prisma.statcastPitch.findMany({
        where: { gameId: { in: gameIds } },
        select: {
          description: true,
          events: true,
        },
      });
      rates = computeUmpRates(rows);
    }

    const ready = gamesSample >= CONTEXT_UMP_MIN_GAMES;
    const asOfDates = finalAssignments
      .map((a) => a.game.officialDate.getTime())
      .filter((t) => Number.isFinite(t));
    const asOf =
      asOfDates.length > 0 ? new Date(Math.max(...asOfDates)) : null;
    const fetchedAt = new Date();

    await this.prisma.officialFeature.upsert({
      where: { officialId: official.id },
      create: {
        officialId: official.id,
        mlbOfficialId,
        ready,
        gamesSample,
        asOf,
        source: 'statcast_ump',
        kRate: rates.kRate != null ? round3(rates.kRate) : null,
        bbRate: rates.bbRate != null ? round3(rates.bbRate) : null,
        calledStrikeRate:
          rates.calledStrikeRate != null
            ? round3(rates.calledStrikeRate)
            : null,
        calledBallRate:
          rates.calledBallRate != null ? round3(rates.calledBallRate) : null,
        metricsJson: {
          pitches: rates.pitches,
          calledStrikes: rates.calledStrikes,
          calledBalls: rates.calledBalls,
          strikeouts: rates.strikeouts,
          walks: rates.walks,
        } as Prisma.InputJsonValue,
        fetchedAt,
      },
      update: {
        ready,
        gamesSample,
        asOf,
        source: 'statcast_ump',
        kRate: rates.kRate != null ? round3(rates.kRate) : null,
        bbRate: rates.bbRate != null ? round3(rates.bbRate) : null,
        calledStrikeRate:
          rates.calledStrikeRate != null
            ? round3(rates.calledStrikeRate)
            : null,
        calledBallRate:
          rates.calledBallRate != null ? round3(rates.calledBallRate) : null,
        metricsJson: {
          pitches: rates.pitches,
          calledStrikes: rates.calledStrikes,
          calledBalls: rates.calledBalls,
          strikeouts: rates.strikeouts,
          walks: rates.walks,
        } as Prisma.InputJsonValue,
        fetchedAt,
      },
    });

    this.logger.debug(
      `Ump rollup ${mlbOfficialId}: games=${gamesSample} ready=${ready}`,
    );
    return { ready, gamesSample };
  }

  async rollupHomePlateForGame(gameId: string): Promise<number | null> {
    const hp = await this.prisma.gameOfficial.findUnique({
      where: {
        gameId_role: { gameId, role: 'Home Plate' },
      },
      include: { official: true },
    });
    if (!hp) return null;
    await this.rollupOfficial(hp.official.mlbOfficialId);
    return hp.official.mlbOfficialId;
  }
}
