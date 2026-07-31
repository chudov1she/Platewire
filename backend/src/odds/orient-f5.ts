import type {
  F5ExtractResult,
  F5Handicap,
  F5Moneyline,
} from './f5-extract.js';

const MAIN_HCP_TARGET = -1.5;

/**
 * Winline П1/П2 → MLB home/away when bind flipped.
 * Totals unchanged. Handicap line negated with side swap.
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

  return {
    ...extracted,
    moneyline,
    handicaps,
    main_total: extracted.main_total,
    main_handicap: pickMainHandicap(handicaps),
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
