import type {
  F5ExtractResult,
  F5Handicap,
  F5Moneyline,
} from './f5-extract.js';
import { pickMainTotal } from './f5-extract.js';

const MAIN_HCP_TARGET = -1.5;
const MAIN_TEAM_TOTAL_TARGET = 2.0;

/**
 * Winline П1/П2 → MLB home/away when bind flipped.
 * Match totals unchanged. Handicap line negated with side swap.
 * Team totals: swap home/away ladders.
 */
export function orientF5ToMlbHome(
  extracted: F5ExtractResult,
  flipped: boolean,
): F5ExtractResult {
  if (!flipped) return extracted;

  const moneyline: F5Moneyline | null = extracted.moneyline
    ? {
        home: extracted.moneyline.away,
        draw: extracted.moneyline.draw,
        away: extracted.moneyline.home,
      }
    : null;

  const handicaps: F5Handicap[] = extracted.handicaps
    .map((h) => ({
      line: -h.line,
      home: h.away,
      away: h.home,
    }))
    .sort((a, b) => a.line - b.line);

  const teamHome = [...extracted.team_totals.away].sort(
    (a, b) => a.line - b.line,
  );
  const teamAway = [...extracted.team_totals.home].sort(
    (a, b) => a.line - b.line,
  );

  return {
    ...extracted,
    moneyline,
    handicaps,
    team_totals: { home: teamHome, away: teamAway },
    main_total: extracted.main_total,
    main_handicap: pickMainHandicap(handicaps),
    main_team_total_home: pickMainTotal(teamHome, MAIN_TEAM_TOTAL_TARGET),
    main_team_total_away: pickMainTotal(teamAway, MAIN_TEAM_TOTAL_TARGET),
  };
}

function pickMainHandicap(handicaps: F5Handicap[]): F5Handicap | null {
  const both = handicaps.filter((h) => h.home != null && h.away != null);
  const pool = both.length ? both : handicaps;
  if (!pool.length) return null;
  const exact = pool.find((h) => h.line === MAIN_HCP_TARGET);
  if (exact) return exact;
  return pool.reduce((best, h) =>
    Math.abs(h.line - MAIN_HCP_TARGET) < Math.abs(best.line - MAIN_HCP_TARGET)
      ? h
      : best,
  );
}
