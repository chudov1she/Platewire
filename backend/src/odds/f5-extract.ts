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

/** Stored in F5OddsSnapshot.mainHandicapJson (no schema migration). */
export type MainTeamTotalsJson = {
  kind: 'team_totals';
  home: F5Total | null;
  away: F5Total | null;
};

export type F5ExtractResult = {
  ok: boolean;
  moneyline: F5Moneyline | null;
  totals: F5Total[];
  handicaps: F5Handicap[];
  team_totals: { home: F5Total[]; away: F5Total[] };
  main_total: F5Total | null;
  main_handicap: F5Handicap | null;
  main_team_total_home: F5Total | null;
  main_team_total_away: F5Total | null;
  missing: string[];
  raw_f5_count: number;
};

const MAIN_TOTAL_TARGET = 4.0;
const MAIN_TEAM_TOTAL_TARGET = 2.0;
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

  if (
    /хит|hit|баз[аыуе]|base\s*hit|индивид|страйк|strike\s*out|ранов\s*команд/i.test(
      low,
    )
  ) {
    return false;
  }

  if (/тотал\s*\(после\s*5[^)]*\)\s+\S+/i.test(name)) return false;

  if (!/тотал\s*\(после\s*5/i.test(low)) return false;

  return true;
}

/**
 * Individual team run total after 5 (личный тотал команды).
 */
export function isTeamTotal(m: NormalizedMarket): boolean {
  if (m.type !== 'total') return false;

  const name = (m.name || '').trim();
  const low = name.toLowerCase();

  if (
    /хит|hit|баз[аыуе]|base\s*hit|страйк|strike\s*out/i.test(low)
  ) {
    return false;
  }

  if (!/после\s*5/i.test(low) && !/тотал\s*\(после\s*5/i.test(low)) {
    return false;
  }

  if (m.team_side === 'home' || m.team_side === 'away') return true;
  if (m.team != null) return true;
  if (/индивидуальный\s*тотал/i.test(low)) return true;
  if (/тотал\s*\(после\s*5[^)]*\)\s+\S+/i.test(name)) return true;

  return false;
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
export function pickMainTotal(
  totals: F5Total[],
  target = MAIN_TOTAL_TARGET,
): F5Total | null {
  if (!totals.length) return null;
  let best = totals[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const t of totals) {
    const balance = Math.abs(Math.log(t.over / t.under));
    const dist = Math.abs(t.line - target);
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
  const teamHome: F5Total[] = [];
  const teamAway: F5Total[] = [];

  for (const m of f5) {
    if (!moneyline && (m.type === '1x2' || m.type === 'moneyline')) {
      moneyline = asMoneyline(m);
      if (!moneyline) continue;
    }
    if (isMatchTotal(m)) {
      const t = asTotal(m);
      if (t) totals.push(t);
    } else if (isTeamTotal(m)) {
      const t = asTotal(m);
      if (t) {
        if (m.team_side === 'away') teamAway.push(t);
        else teamHome.push(t); // home or inferred
      }
    }
    if (m.type === 'handicap') {
      const h = asHandicap(m);
      if (h) handicaps.push(h);
    }
  }

  totals.sort((a, b) => a.line - b.line);
  handicaps.sort((a, b) => a.line - b.line);
  teamHome.sort((a, b) => a.line - b.line);
  teamAway.sort((a, b) => a.line - b.line);

  const main_total = pickMainTotal(totals);
  const main_handicap = pickMainHandicap(handicaps);
  const main_team_total_home = pickMainTotal(teamHome, MAIN_TEAM_TOTAL_TARGET);
  const main_team_total_away = pickMainTotal(teamAway, MAIN_TEAM_TOTAL_TARGET);

  const missing: string[] = [];
  if (!moneyline) missing.push('moneyline');
  if (!totals.length) missing.push('total');
  if (!teamHome.length && !teamAway.length) missing.push('team_total');
  if (!handicaps.length) missing.push('handicap');

  const ok = moneyline != null && totals.length > 0;

  return {
    ok,
    moneyline,
    totals,
    handicaps,
    team_totals: { home: teamHome, away: teamAway },
    main_total,
    main_handicap,
    main_team_total_home,
    main_team_total_away,
    missing,
    raw_f5_count: f5.length,
  };
}

/** Payload for F5OddsSnapshot.mainHandicapJson — team IT mains, no new columns. */
export function toMainTeamTotalsJson(
  extracted: Pick<
    F5ExtractResult,
    'main_team_total_home' | 'main_team_total_away'
  >,
): MainTeamTotalsJson {
  return {
    kind: 'team_totals',
    home: extracted.main_team_total_home,
    away: extracted.main_team_total_away,
  };
}

export function parseMainTeamTotalsJson(
  raw: unknown,
): MainTeamTotalsJson | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.kind !== 'team_totals') return null;
  const asT = (v: unknown): F5Total | null => {
    if (!v || typeof v !== 'object') return null;
    const t = v as Record<string, unknown>;
    const line = Number(t.line);
    const over = Number(t.over);
    const under = Number(t.under);
    if (![line, over, under].every(Number.isFinite)) return null;
    return { line, over, under };
  };
  return {
    kind: 'team_totals',
    home: asT(o.home),
    away: asT(o.away),
  };
}
