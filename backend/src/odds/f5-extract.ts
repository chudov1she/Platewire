import type { NormalizedMarket } from './winline/normalize.js';

export type F5Moneyline = {
  home: number;
  draw: number | null;
  away: number;
};

export type F5Total = {
  line: number;
  over: number;
  under: number;
};

export type F5Handicap = {
  line: number;
  home: number | null;
  away: number | null;
};

export type F5ExtractResult = {
  ok: boolean;
  moneyline: F5Moneyline | null;
  totals: F5Total[];
  handicaps: F5Handicap[];
  main_total: F5Total | null;
  main_handicap: F5Handicap | null;
  missing: string[];
  raw_f5_count: number;
};

const MAIN_TOTAL_TARGET = 4.0;
const MAIN_HCP_TARGET = -1.5;

/**
 * Match run total after 5 only.
 * Excludes: team IT, hits ("хитов"), other prop totals.
 */
export function isMatchTotal(m: NormalizedMarket): boolean {
  if (m.type !== 'total') return false;
  if (m.team != null || m.team_side != null) return false;

  const name = (m.name || '').trim();
  const low = name.toLowerCase();

  // Prop / non-run totals
  if (
    /хит|hit|баз[аыуе]|base\s*hit|индивид|страйк|strike\s*out|ранов\s*команд/i.test(
      low,
    )
  ) {
    return false;
  }

  // "Тотал (после 5 ин.) Тампа-Бэй" — team suffix after closing paren
  if (/тотал\s*\(после\s*5[^)]*\)\s+\S+/i.test(name)) return false;

  // Must be plain F5 total title
  if (!/тотал\s*\(после\s*5/i.test(low)) return false;

  return true;
}

function asMoneyline(m: NormalizedMarket): F5Moneyline | null {
  if (m.type !== '1x2' && m.type !== 'moneyline') return null;
  const home = m.home ?? null;
  const away = m.away ?? null;
  if (home == null || away == null) return null;
  return { home, draw: m.draw ?? null, away };
}

function asTotal(m: NormalizedMarket): F5Total | null {
  if (m.line == null || m.over == null || m.under == null) return null;
  return { line: m.line, over: m.over, under: m.under };
}

function asHandicap(m: NormalizedMarket): F5Handicap | null {
  if (m.line == null) return null;
  if (m.home == null && m.away == null) return null;
  return { line: m.line, home: m.home ?? null, away: m.away ?? null };
}

/** Prefer balanced O/U; soft bias to classic F5 ~4.0 as tiebreaker. */
function pickMainTotal(totals: F5Total[]): F5Total | null {
  if (!totals.length) return null;
  let best = totals[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const t of totals) {
    const balance = Math.abs(Math.log(t.over / t.under));
    const dist = Math.abs(t.line - MAIN_TOTAL_TARGET);
    const score = balance * 10 + dist * 0.35;
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
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

export function extractF5Markets(markets: NormalizedMarket[]): F5ExtractResult {
  const f5 = markets.filter((m) => m.period === 'after_5');
  let moneyline: F5Moneyline | null = null;
  const totals: F5Total[] = [];
  const handicaps: F5Handicap[] = [];

  for (const m of f5) {
    if (!moneyline && (m.type === '1x2' || m.type === 'moneyline')) {
      moneyline = asMoneyline(m);
      if (!moneyline) continue;
    }
    if (isMatchTotal(m)) {
      const t = asTotal(m);
      if (t) totals.push(t);
    }
    if (m.type === 'handicap') {
      const h = asHandicap(m);
      if (h) handicaps.push(h);
    }
  }

  totals.sort((a, b) => a.line - b.line);
  handicaps.sort((a, b) => a.line - b.line);

  const main_total = pickMainTotal(totals);
  const main_handicap = pickMainHandicap(handicaps);

  const missing: string[] = [];
  if (!moneyline) missing.push('moneyline');
  if (!totals.length) missing.push('total');
  if (!handicaps.length) missing.push('handicap');

  const ok = moneyline != null && totals.length > 0;

  return {
    ok,
    moneyline,
    totals,
    handicaps,
    main_total,
    main_handicap,
    missing,
    raw_f5_count: f5.length,
  };
}
