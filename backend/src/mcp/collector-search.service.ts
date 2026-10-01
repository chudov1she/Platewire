import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export type SearchHit = {
  type: 'game' | 'player' | 'official';
  id: string;
  name: string | null;
  game_id: string | null;
  detail?: string;
};

@Injectable()
export class CollectorSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: string, limit = 8): Promise<{ hits: SearchHit[] }> {
    const q = query.trim();
    const take = Math.min(Math.max(limit, 1), 20);
    if (!q) return { hits: [] };

    const date = /^\d{4}-\d{2}-\d{2}$/.test(q)
      ? new Date(`${q}T00:00:00.000Z`)
      : null;

    const [games, players, officials] = await Promise.all([
      this.prisma.game.findMany({
        where: date
          ? { officialDate: date }
          : {
              OR: [
                { homeTeam: { name: { contains: q, mode: 'insensitive' } } },
                {
                  homeTeam: {
                    abbreviation: { equals: q, mode: 'insensitive' },
                  },
                },
                { awayTeam: { name: { contains: q, mode: 'insensitive' } } },
                {
                  awayTeam: {
                    abbreviation: { equals: q, mode: 'insensitive' },
                  },
                },
              ],
            },
        include: { homeTeam: true, awayTeam: true },
        orderBy: { gameDateUtc: 'desc' },
        take,
      }),
      date
        ? Promise.resolve([])
        : this.prisma.player.findMany({
            where: { fullName: { contains: q, mode: 'insensitive' } },
            orderBy: { fullName: 'asc' },
            take,
          }),
      date
        ? Promise.resolve([])
        : this.prisma.official.findMany({
            where: {
              OR: [
                { fullName: { contains: q, mode: 'insensitive' } },
                { umpScorecardName: { contains: q, mode: 'insensitive' } },
              ],
            },
            orderBy: { fullName: 'asc' },
            take,
          }),
    ]);

    const hits: SearchHit[] = [
      ...games.map((game) => ({
        type: 'game' as const,
        id: game.id,
        name: `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`,
        game_id: game.id,
        detail: `${game.officialDate.toISOString().slice(0, 10)} ${game.status}`,
      })),
      ...players.map((player) => ({
        type: 'player' as const,
        id: String(player.mlbPlayerId),
        name: player.fullName,
        game_id: null,
        detail: player.primaryPosition ?? undefined,
      })),
      ...officials.map((official) => ({
        type: 'official' as const,
        id: String(official.mlbOfficialId),
        name: official.fullName ?? official.umpScorecardName,
        game_id: null,
      })),
    ];

    return { hits: hits.slice(0, 20) };
  }
}
