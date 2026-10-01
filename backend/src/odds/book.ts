import type { NormalizedMarket } from './winline/normalize.js';

export type BookKind =
  | 'moneyline'
  | 'total'
  | 'team_total'
  | 'handicap'
  | 'hits_total'
  | 'team_hits'
  | 'win_rest'
  | 'yes_no'
  | 'race'
  | 'other';

export type BookStat = 'runs' | 'hits' | 'other';

export type BookSide = 'match' | 'home' | 'away';

export type BookSelection = {
  key: string;
  label: string;
  odd: number | null;
};

/** One priced line, labeled at capture. Home/away are MLB sides after orient. */
export type BookQuote = {
  kind: BookKind;
  period: string;
  stat: BookStat;
  side: BookSide | null;
  line: number | null;
  home: number | null;
  draw: number | null;
  away: number | null;
  over: number | null;
  under: number | null;
  yes: number | null;
  no: number | null;
  name: string;
  group: string;
  selections: BookSelection[];
};

const HITS = /хит|hit|баз[аыуе]|base\s*hit/i;

function num(v: number | null | undefined): number | null {
  return v == null || !Number.isFinite(v) ? null : v;
}

function selectionsOf(m: NormalizedMarket): BookSelection[] {
  return (m.outcomes ?? [])
    .filter((o) => o.odd != null || o.label)
    .map((o) => ({ key: o.key, label: o.label, odd: num(o.odd) }));
}

function hasPrice(q: BookQuote): boolean {
  return (
    [q.home, q.draw, q.away, q.over, q.under, q.yes, q.no].some((n) => n != null) ||
    q.selections.some((s) => s.odd != null)
  );
}

function teamSide(m: NormalizedMarket): 'home' | 'away' | null {
  if (m.team_side === 'home' || m.team_side === 'away') return m.team_side;
  return null;
}

/**
 * Every normalized Winline row becomes one quote.
 * Kind, period, stat and side are set here — callers do not re-parse titles.
 */
export function classifyBook(markets: NormalizedMarket[]): BookQuote[] {
  const out: BookQuote[] = [];

  for (const m of markets) {
    const hits = HITS.test(m.name || '');
    const knownSide = teamSide(m);
    let kind: BookKind = 'other';
    let stat: BookStat = 'other';
    let side: BookSide | null = knownSide;

    if (m.type === '1x2' || m.type === 'moneyline') {
      kind = 'moneyline';
      stat = 'runs';
      side = 'match';
    } else if (m.type === 'win_rest') {
      kind = 'win_rest';
      stat = 'runs';
      side = 'match';
    } else if (m.type === 'handicap') {
      kind = 'handicap';
      stat = hits ? 'hits' : 'runs';
      side = 'match';
    } else if (m.type === 'total') {
      stat = hits ? 'hits' : 'runs';
      if (hits && knownSide) kind = 'team_hits';
      else if (hits) kind = 'hits_total';
      else if (knownSide || m.team) kind = 'team_total';
      else kind = 'total';
      if (kind === 'total' || kind === 'hits_total') side = 'match';
      else side = knownSide;
    } else if (m.type === 'both_to_score' || m.type === 'game_end') {
      kind = 'yes_no';
      side = 'match';
    } else if (m.type === 'race') {
      kind = 'race';
      side = knownSide ?? 'match';
    }

    const quote: BookQuote = {
      kind,
      period: m.period || 'other',
      stat,
      side,
      line: num(m.line),
      home: num(m.home),
      draw: num(m.draw),
      away: num(m.away),
      over: num(m.over),
      under: num(m.under),
      yes: num(m.yes),
      no: num(m.no),
      name: m.name,
      group: m.group || '',
      selections: selectionsOf(m),
    };
    if (hasPrice(quote)) out.push(quote);
  }

  return out;
}

/** Swap Winline П1/П2 onto MLB home/away. Match totals stay put. */
export function orientBook(book: BookQuote[], flipped: boolean): BookQuote[] {
  if (!flipped) return book;
  return book.map((q) => ({
    ...q,
    home: q.away,
    away: q.home,
    side: q.side === 'home' ? 'away' : q.side === 'away' ? 'home' : q.side,
    line: q.kind === 'handicap' && q.line != null ? -q.line : q.line,
    selections: q.selections.map((s) => ({
      ...s,
      key: s.key === 'home' ? 'away' : s.key === 'away' ? 'home' : s.key,
    })),
  }));
}
