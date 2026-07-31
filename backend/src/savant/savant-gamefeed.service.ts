import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BaseballSavantClient,
  savantStatsPayload,
} from './savant.client.js';

export type GamefeedSyncResult = {
  mlbGamePk: number;
  gameId: string | null;
  gameStatus: string | null;
  error?: string;
};

@Injectable()
export class SavantGamefeedService {
  private readonly logger = new Logger(SavantGamefeedService.name);
  private readonly client = new BaseballSavantClient();

  constructor(private readonly prisma: PrismaService) {}

  async syncByMlbGamePk(mlbGamePk: number): Promise<GamefeedSyncResult> {
    const game = await this.prisma.game.findUnique({
      where: { mlbGamePk },
    });
    if (!game) {
      return {
        mlbGamePk,
        gameId: null,
        gameStatus: null,
        error: 'Game not in DB',
      };
    }

    try {
      const data = await this.client.fetchGamefeed(mlbGamePk);
      const fetchedAt = new Date();
      const gameStatus = stringOrNull(data.game_status);
      const gameStatusCode = stringOrNull(data.game_status_code);
      const stats = savantStatsPayload(data);

      await this.prisma.savantGamefeedSnapshot.upsert({
        where: { gameId: game.id },
        create: {
          gameId: game.id,
          mlbGamePk,
          gameStatusCode,
          gameStatus,
          cacheKey: stringOrNull(data.cacheKey),
          cacheHit: stringOrNull(data.cache_hit),
          scoreboardJson: jsonOrNull(data.scoreboard),
          statsJson: stats as Prisma.InputJsonValue | undefined,
          currentPlayJson: jsonOrNull(data.currentPlay),
          topPerformersJson: jsonOrNull(data.topPerformers),
          rawJson: data as Prisma.InputJsonValue,
          fetchedAt,
        },
        update: {
          gameStatusCode,
          gameStatus,
          cacheKey: stringOrNull(data.cacheKey),
          cacheHit: stringOrNull(data.cache_hit),
          scoreboardJson: jsonOrNull(data.scoreboard),
          statsJson: (stats as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          currentPlayJson: jsonOrNull(data.currentPlay),
          topPerformersJson: jsonOrNull(data.topPerformers),
          rawJson: data as Prisma.InputJsonValue,
          fetchedAt,
        },
      });

      this.logger.log(`Gamefeed ${mlbGamePk}: status=${gameStatus}`);
      return { mlbGamePk, gameId: game.id, gameStatus };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Gamefeed sync ${mlbGamePk} failed: ${message}`);
      return {
        mlbGamePk,
        gameId: game.id,
        gameStatus: null,
        error: message,
      };
    }
  }
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function jsonOrNull(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}
