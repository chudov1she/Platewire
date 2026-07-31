import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BaseballSavantClient,
  normalizeSavantPlayerName,
} from './savant.client.js';
import { mapStatcastRow, parseStatcastCsv } from './statcast-csv.js';

export type StatcastSyncResult = {
  mlbGamePk: number;
  gameId: string | null;
  rowsSeen: number;
  rowsUpserted: number;
  error?: string;
};

@Injectable()
export class SavantStatcastService {
  private readonly logger = new Logger(SavantStatcastService.name);
  private readonly client = new BaseballSavantClient();

  constructor(private readonly prisma: PrismaService) {}

  async syncByMlbGamePk(mlbGamePk: number): Promise<StatcastSyncResult> {
    const game = await this.prisma.game.findUnique({
      where: { mlbGamePk },
    });
    if (!game) {
      return {
        mlbGamePk,
        gameId: null,
        rowsSeen: 0,
        rowsUpserted: 0,
        error: 'Game not in DB',
      };
    }

    try {
      const csv = await this.client.fetchStatcastCsv(mlbGamePk);
      const rows = parseStatcastCsv(csv);
      const fetchedAt = new Date();
      let rowsUpserted = 0;

      for (const row of rows) {
        const mapped = mapStatcastRow(row);
        const batterId = await this.ensurePlayer(
          mapped.sourceBatterId,
          normalizeSavantPlayerName(row.player_name),
        );
        const pitcherId = await this.ensurePlayer(mapped.sourcePitcherId, null);

        await this.prisma.statcastPitch.upsert({
          where: {
            gameId_atBatNumber_pitchNumber: {
              gameId: game.id,
              atBatNumber: mapped.atBatNumber,
              pitchNumber: mapped.pitchNumber,
            },
          },
          create: {
            gameId: game.id,
            mlbGamePk,
            ...mapped,
            batterId,
            pitcherId,
            rawRowJson: mapped.rawRowJson as Prisma.InputJsonValue,
            fetchedAt,
          },
          update: {
            ...mapped,
            batterId,
            pitcherId,
            rawRowJson: mapped.rawRowJson as Prisma.InputJsonValue,
            fetchedAt,
          },
        });
        rowsUpserted += 1;
      }

      this.logger.log(
        `Statcast ${mlbGamePk}: rows=${rows.length} upserted=${rowsUpserted}`,
      );
      return {
        mlbGamePk,
        gameId: game.id,
        rowsSeen: rows.length,
        rowsUpserted,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Statcast sync ${mlbGamePk} failed: ${message}`);
      return {
        mlbGamePk,
        gameId: game.id,
        rowsSeen: 0,
        rowsUpserted: 0,
        error: message,
      };
    }
  }

  private async ensurePlayer(
    mlbPlayerId: number | null,
    fullName: string | null,
  ): Promise<string | null> {
    if (mlbPlayerId === null) return null;
    const player = await this.prisma.player.upsert({
      where: { mlbPlayerId },
      create: { mlbPlayerId, fullName },
      update: fullName ? { fullName } : {},
    });
    return player.id;
  }
}
