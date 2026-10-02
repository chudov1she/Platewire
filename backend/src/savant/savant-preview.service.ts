import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BaseballSavantClient,
  extractTeamsJson,
  summarizePreviewTeams,
  type SavantPreviewSummary,
} from './savant.client.js';

export type PreviewSyncResult = {
  mlbGamePk: number;
  gameId: string | null;
  hasLineup: boolean;
  hasProbable: boolean;
  error?: string;
};

@Injectable()
export class SavantPreviewService {
  private readonly logger = new Logger(SavantPreviewService.name);
  private readonly client = new BaseballSavantClient();

  constructor(private readonly prisma: PrismaService) {}

  async syncByMlbGamePk(mlbGamePk: number): Promise<PreviewSyncResult> {
    const game = await this.prisma.game.findUnique({
      where: { mlbGamePk },
    });
    if (!game) {
      return {
        mlbGamePk,
        gameId: null,
        hasLineup: false,
        hasProbable: false,
        error: 'Game not in DB',
      };
    }

    const gameDate = game.officialDate.toISOString().slice(0, 10);
    try {
      const html = await this.client.fetchPreviewHtml(mlbGamePk, gameDate);
      const teams = extractTeamsJson(html);
      const summary = summarizePreviewTeams(teams);
      const hasLineup = summary.home.has_lineup || summary.away.has_lineup;
      const hasProbable =
        summary.home.has_probable || summary.away.has_probable;
      const fetchedAt = new Date();

      await this.prisma.savantPreviewSnapshot.upsert({
        where: { gameId: game.id },
        create: {
          gameId: game.id,
          mlbGamePk,
          gameDate,
          hasLineup,
          hasProbable,
          previewJson: teams as Prisma.InputJsonValue,
          summaryJson: summary as unknown as Prisma.InputJsonValue,
          fetchedAt,
        },
        update: {
          gameDate,
          hasLineup,
          hasProbable,
          previewJson: teams as Prisma.InputJsonValue,
          summaryJson: summary as unknown as Prisma.InputJsonValue,
          fetchedAt,
        },
      });

      await this.upsertLineupPlayers(game.id, summary);

      this.logger.log(
        `Preview ${mlbGamePk}: lineup=${hasLineup} probable=${hasProbable}`,
      );

      return { mlbGamePk, gameId: game.id, hasLineup, hasProbable };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Preview sync ${mlbGamePk} failed: ${message}`);
      return {
        mlbGamePk,
        gameId: game.id,
        hasLineup: false,
        hasProbable: false,
        error: message,
      };
    }
  }

  private async upsertLineupPlayers(
    gameId: string,
    summary: SavantPreviewSummary,
  ): Promise<void> {
    await this.prisma.gameLineupPlayer.deleteMany({ where: { gameId } });

    for (const side of ['home', 'away'] as const) {
      for (const row of summary[side].lineup) {
        // The Savant board can list two players on the same batting order (a
        // pinch-hitter next to the starter) — the DB is unique on
        // (gameId, side, battingOrder), so a duplicate used to abort the whole
        // write and leave the lineup truncated at the last clean row.
        // The first row on a shared order wins: it is the one the board lists as
        // the starter's slot.
        const taken = await this.prisma.gameLineupPlayer.findUnique({
          where: {
            gameId_side_battingOrder: {
              gameId,
              side,
              battingOrder: row.batting_order,
            },
          },
          select: { id: true },
        });
        if (taken) {
          this.logger.warn(
            `lineup ${gameId} ${side}: batting order ${row.batting_order} already taken, ` +
              `skipping ${row.full_name ?? 'unknown'}`,
          );
          continue;
        }

        let playerId: string | null = null;
        if (row.mlb_player_id !== null) {
          const player = await this.prisma.player.upsert({
            where: { mlbPlayerId: row.mlb_player_id },
            create: {
              mlbPlayerId: row.mlb_player_id,
              fullName: row.full_name,
            },
            update: {
              fullName: row.full_name ?? undefined,
            },
          });
          playerId = player.id;
        }

        await this.prisma.gameLineupPlayer.create({
          data: {
            gameId,
            side,
            battingOrder: row.batting_order,
            playerId,
            mlbPlayerId: row.mlb_player_id,
            fullName: row.full_name,
            xwoba: row.xwoba,
            xslg: row.xslg,
            xba: row.xba,
            barrelRate: row.barrel_batted_rate,
            hardHitPct: row.hard_hit_percent,
          },
        });
      }

      for (const pitcher of summary[side].pitchers) {
        if (pitcher.mlb_player_id === null) continue;
        await this.prisma.player.upsert({
          where: { mlbPlayerId: pitcher.mlb_player_id },
          create: {
            mlbPlayerId: pitcher.mlb_player_id,
            fullName: pitcher.full_name,
          },
          update: {
            fullName: pitcher.full_name ?? undefined,
          },
        });
      }
    }
  }
}
