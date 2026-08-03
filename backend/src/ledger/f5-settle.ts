/** F5 bet settlement helpers. */

export type SettleResult = 'WIN' | 'LOSE' | 'PUSH' | 'PENDING';

export function actualF5Outcome(
  f5Home: number,
  f5Away: number,
  marginTie = 0.5,
): 'home' | 'away' | 'tie' {
  const margin = f5Away - f5Home;
  if (margin > marginTie) return 'away';
  if (margin < -marginTie) return 'home';
  return 'tie';
}

export function settleBetResult(opts: {
  market: string | null | undefined;
  side: string | null | undefined;
  line?: number | null;
  team?: string | null;
  f5Home: number;
  f5Away: number;
}): SettleResult {
  if (!opts.market || !opts.side) return 'PENDING';
  const market = opts.market.toLowerCase();
  let side = opts.side.toLowerCase();

  if (market === 'moneyline') {
    const outcome = actualF5Outcome(opts.f5Home, opts.f5Away);
    if (outcome === 'tie') {
      if (side === 'draw' || side === 'tie' || side === 'x') return 'WIN';
      return 'PUSH';
    }
    return side === outcome ? 'WIN' : 'LOSE';
  }

  if (market === 'total') {
    const total = opts.f5Home + opts.f5Away;
    const lineVal = opts.line ?? 4.5;
    if (
      Math.abs(lineVal - Math.round(lineVal)) < 0.01 &&
      Math.abs(total - lineVal) < 0.01
    ) {
      return 'PUSH';
    }
    if (side === 'over') return total > lineVal ? 'WIN' : 'LOSE';
    if (side === 'under') return total < lineVal ? 'WIN' : 'LOSE';
  }

  if (market === 'team_total') {
    let team = (opts.team ?? '').toLowerCase();
    const encoded = /^(home|away)_(over|under)$/.exec(side);
    if (encoded) {
      team = encoded[1]!;
      side = encoded[2]!;
    }
    const runs =
      team === 'away' ? opts.f5Away : team === 'home' ? opts.f5Home : null;
    if (runs == null) return 'PENDING';
    const lineVal = opts.line ?? 2.0;
    if (
      Math.abs(lineVal - Math.round(lineVal)) < 0.01 &&
      Math.abs(runs - lineVal) < 0.01
    ) {
      return 'PUSH';
    }
    if (side === 'over') return runs > lineVal ? 'WIN' : 'LOSE';
    if (side === 'under') return runs < lineVal ? 'WIN' : 'LOSE';
  }

  if (market === 'runline') {
    const lineVal = opts.line ?? 1.5;
    let adjusted: number;
    if (side === 'home') adjusted = opts.f5Home + lineVal - opts.f5Away;
    else if (side === 'away') adjusted = opts.f5Away + lineVal - opts.f5Home;
    else return 'PENDING';
    if (
      Math.abs(lineVal - Math.round(lineVal)) < 0.01 &&
      Math.abs(adjusted) < 0.01
    ) {
      return 'PUSH';
    }
    return adjusted > 0 ? 'WIN' : 'LOSE';
  }

  return 'PENDING';
}

export function profitForResult(
  stake: number | null | undefined,
  odds: number | null | undefined,
  result: string,
): number | null {
  const normalized = (result || 'pending').trim().toUpperCase();
  if (normalized === 'PENDING') return null;
  if (normalized === 'PUSH' || normalized === 'VOID') return 0;
  if (stake == null || odds == null || odds <= 1) return null;
  if (normalized === 'WIN') return stake * odds - stake;
  if (normalized === 'LOSE' || normalized === 'LOSS') return -stake;
  return null;
}

/** Map settle result to lowercase ledger status. */
export function toLedgerStatus(result: SettleResult): string {
  if (result === 'WIN') return 'win';
  if (result === 'LOSE') return 'loss';
  if (result === 'PUSH') return 'push';
  return 'pending';
}

export function marketLabel(
  market: string,
  side: string,
  awayAbbr: string,
  homeAbbr: string,
  line?: number | null,
): string {
  const m = market.toLowerCase();
  const s = side.toLowerCase();
  if (m === 'moneyline') {
    if (s === 'home') return `${homeAbbr} ML`;
    if (s === 'away') return `${awayAbbr} ML`;
    return 'F5 Draw';
  }
  if (m === 'total') {
    const ln = line ?? 4.5;
    return s === 'over' ? `Over ${ln}` : `Under ${ln}`;
  }
  if (m === 'team_total') {
    const encoded = /^(home|away)_(over|under)$/.exec(s);
    const team = encoded?.[1] ?? '';
    const ou = encoded?.[2] ?? s;
    const abbr = team === 'away' ? awayAbbr : homeAbbr;
    const ln = line ?? 2;
    return `${abbr} ${ou === 'under' ? 'Under' : 'Over'} ${ln}`;
  }
  if (m === 'runline') {
    const ln = line ?? -1.5;
    const team = s === 'home' ? homeAbbr : awayAbbr;
    return `${team} ${ln > 0 ? '+' : ''}${ln}`;
  }
  return `${market} ${side}`;
}

/** Extract F5 (innings 1-5) runs from a Savant gamefeed scoreboard linescore. */
export function extractF5RunsFromScoreboard(raw: unknown): {
  home: number | null;
  away: number | null;
} {
  if (!raw || typeof raw !== 'object') return { home: null, away: null };
  const board = raw as Record<string, unknown>;
  const linescore =
    (board.linescore as Record<string, unknown> | undefined) ||
    (board.lineScore as Record<string, unknown> | undefined) ||
    board;
  const innings = (linescore.innings ??
    (linescore as { innings?: unknown }).innings) as
    | Array<Record<string, unknown>>
    | undefined;
  if (!Array.isArray(innings) || !innings.length) {
    return { home: null, away: null };
  }

  let home = 0;
  let away = 0;
  let seen = 0;
  for (const inn of innings) {
    const num = Number(inn.num ?? inn.inning ?? inn.number);
    if (!Number.isFinite(num) || num < 1 || num > 5) continue;
    const a = inn.away as Record<string, unknown> | number | undefined;
    const h = inn.home as Record<string, unknown> | number | undefined;
    const aRuns =
      typeof a === 'number' ? a : Number((a as Record<string, unknown>)?.runs ?? 0);
    const hRuns =
      typeof h === 'number' ? h : Number((h as Record<string, unknown>)?.runs ?? 0);
    away += Number.isFinite(aRuns) ? aRuns : 0;
    home += Number.isFinite(hRuns) ? hRuns : 0;
    seen += 1;
  }
  if (seen < 5) return { home: null, away: null };
  return { home, away };
}
