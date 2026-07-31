import { Injectable } from '@nestjs/common';
import { isF5OddsStage, type F5OddsStage } from '../odds/f5-scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { MarketLine } from './formula.types.js';

export type MarketLoadResult = {
  markets: MarketLine[];
  track: F5OddsStage;
  notes: string[];
  marketsUsed: boolean;
  locked: boolean;
  source: string | null;
  stale: boolean;
};

/** ML needs home+away; total needs over+under; at least one complete market. */
export function marketsComplete(lines: MarketLine[]): boolean {
  const hasMl = lines.some((l) => l.market === 'moneyline');
  const hasTotal = lines.some((l) => l.market === 'total');
  if (!hasMl && !hasTotal) return false;

  if (hasMl) {
    const home = lines.some(
      (l) => l.market === 'moneyline' && l.side === 'home',
    );
    const away = lines.some(
      (l) => l.market === 'moneyline' && l.side === 'away',
    );
    if (!home || !away) return false;
  }

  if (hasTotal) {
    const over = lines.some((l) => l.market === 'total' && l.side === 'over');
    const under = lines.some((l) => l.market === 'total' && l.side === 'under');
    if (!over || !under) return false;
  }

  return true;
}

/** Sane F5 book odds for picks — filters misparsed / novelty longshots. */
export function isSaneF5Odds(
  odds: number,
  market: MarketLine['market'],
  side?: string,
): boolean {
  if (!Number.isFinite(odds)) return false;
  if (odds < 1.15) return false;
  if (market === 'moneyline' && side === 'draw') return odds <= 15;
  return odds <= 5.5;
}

function pushIfSane(out: MarketLine[], line: MarketLine): void {
  if (!isSaneF5Odds(line.decimal_odds, line.market, line.side)) return;
  out.push(line);
}

type F5MoneylineJson = { home: number; away: number; draw: number | null };
type F5TotalJson = { line: number; over: number; under: number };
type F5HandicapJson = { line: number; home: number | null; away: number | null };

function snapshotToLines(snap: {
  moneylineJson: unknown;
  mainTotalJson: unknown;
  mainHandicapJson: unknown;
}): MarketLine[] {
  const out: MarketLine[] = [];
  const ml = snap.moneylineJson as F5MoneylineJson | null;
  if (ml) {
    pushIfSane(out, { market: 'moneyline', side: 'home', decimal_odds: ml.home });
    pushIfSane(out, { market: 'moneyline', side: 'away', decimal_odds: ml.away });
    if (ml.draw != null) {
      pushIfSane(out, { market: 'moneyline', side: 'draw', decimal_odds: ml.draw });
    }
  }
  const total = snap.mainTotalJson as F5TotalJson | null;
  if (total) {
    pushIfSane(out, {
      market: 'total',
      side: 'over',
      decimal_odds: total.over,
      line: total.line,
    });
    pushIfSane(out, {
      market: 'total',
      side: 'under',
      decimal_odds: total.under,
      line: total.line,
    });
  }
  const hcp = snap.mainHandicapJson as F5HandicapJson | null;
  if (hcp) {
    if (hcp.home != null) {
      pushIfSane(out, {
        market: 'runline',
        side: 'home',
        decimal_odds: hcp.home,
        line: hcp.line,
      });
    }
    if (hcp.away != null) {
      pushIfSane(out, {
        market: 'runline',
        side: 'away',
        decimal_odds: hcp.away,
        line: -hcp.line,
      });
    }
  }
  return out;
}

/**
 * Loads the exact F5OddsSnapshot for the requested stage — never borrows
 * another track's markets (prematch/inn1/inn2 are three independent bets).
 */
@Injectable()
export class MarketLoaderService {
  constructor(private readonly prisma: PrismaService) {}

  async load(
    gameId: string,
    track: string = 'prematch',
  ): Promise<MarketLoadResult> {
    const stage: F5OddsStage = isF5OddsStage(track) ? track : 'prematch';
    const notes: string[] = [];

    const snap = await this.prisma.f5OddsSnapshot.findUnique({
      where: { gameId_stage: { gameId, stage } },
    });

    if (!snap) {
      notes.push('no_odds');
      return {
        markets: [],
        track: stage,
        notes,
        marketsUsed: false,
        locked: false,
        source: null,
        stale: false,
      };
    }

    const markets = snapshotToLines(snap);
    const complete = marketsComplete(markets);
    if (!complete) notes.push('incomplete_markets');
    if (!snap.ok) notes.push('extract_not_ok');

    return {
      markets,
      track: stage,
      notes,
      marketsUsed: complete && snap.ok,
      locked: snap.locked,
      source: 'winline',
      stale: false,
    };
  }
}
