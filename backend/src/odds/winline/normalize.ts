export type RawSelection = { name: string; odd: number | null };
export type RawRow = { label: string; selections: RawSelection[] };
export type RawCategory = { group: string; title: string; rows: RawRow[] };

export type MarketOutcome = {
  key: string;
  label: string;
  odd: number | null;
};

export type NormalizedMarket = {
  name: string;
  type: string;
  group: string;
  period: string;
  team: string | null;
  team_side: string | null;
  row: string | null;
  line: number | null;
  over?: number | null;
  under?: number | null;
  home?: number | null;
  draw?: number | null;
  away?: number | null;
  yes?: number | null;
  no?: number | null;
  outcomes: MarketOutcome[];
};

const RE_LINE = /^[бмbmu]\s*([+-]?\d+(?:[.,]\d+)?)$/i;
const RE_INNING = /(\d+)\s*иннинг/i;
const RE_F5 = /после\s*5/i;
const RE_INTERVAL = /интервал/i;

function f(v: unknown): number | null {
  if (v == null) return null;
  try {
    const x = Number(
      String(v).replace(',', '.').replace('−', '-').replace('–', '-'),
    );
    if (!Number.isFinite(x) || x < 1.01 || x > 500) return null;
    return Math.round(x * 1000) / 1000;
  } catch {
    return null;
  }
}

function lineNum(raw: string): number | null {
  try {
    const x = Number(
      String(raw).replace(',', '.').replace('−', '-').replace('–', '-'),
    );
    return Number.isFinite(x) ? x : null;
  } catch {
    return null;
  }
}

function normName(s: string): string {
  return (s || '').toLowerCase().split(/\s+/).join(' ');
}

function detectTeam(
  title: string,
  team1: string,
  team2: string,
): [string | null, string | null] {
  const t = normName(title);
  for (const [side, name] of [
    ['home', team1],
    ['away', team2],
  ] as const) {
    const n = normName(name);
    if (n && (t.endsWith(n) || t.includes(` ${n}`) || t === n)) {
      return [name, side];
    }
  }
  return [null, null];
}

function detectType(title: string): string {
  const low = title.toLowerCase();
  if (low.includes('обе забьют') || low.includes('обе забь')) return 'both_to_score';
  if (low.includes('гонка')) return 'race';
  if (low.includes('когда закончится')) return 'game_end';
  if (low.includes('выиграет остаток')) return 'win_rest';
  if (low.includes('фора')) return 'handicap';
  if (low.includes('тотал') || low.includes('индивидуальный тотал')) return 'total';
  if (low.includes('исход') || low.includes('1x2') || low.includes('1х2')) return '1x2';
  if (['исход 12', 'исход 1-2', 'исход 1–2'].includes(low.trim())) return 'moneyline';
  return 'other';
}

function detectPeriod(title: string, rowLabel = ''): string {
  const blob = `${title} ${rowLabel}`.toLowerCase();
  if (RE_F5.test(blob)) return 'after_5';
  if (RE_INTERVAL.test(blob)) {
    const m = blob.match(/(\d+)\s*[-–—]\s*(\d+)/);
    if (m) return `innings_${m[1]}_${m[2]}`;
    return 'innings_interval';
  }
  const m = blob.match(RE_INNING);
  if (m) return `inning_${m[1]}`;
  if (blob.includes('матч') || blob.includes('основн')) return 'match';
  return 'other';
}

function selectionKey(name: string): string {
  const n = (name || '').trim().toLowerCase().replace(/ё/g, 'е');
  if (['п1', '1', 'w1', 'home'].includes(n)) return 'home';
  if (['п2', '2', 'w2', 'away'].includes(n)) return 'away';
  if (['x', 'х', 'ничья', 'draw'].includes(n)) return 'draw';
  if (['да', 'yes'].includes(n)) return 'yes';
  if (['нет', 'no'].includes(n)) return 'no';
  if (n.startsWith('б ') || (n.startsWith('б') && /^\d/.test(n.slice(1)))) return 'over';
  if (n.startsWith('м ') || (n.startsWith('м') && /^\d/.test(n.slice(1)))) return 'under';
  const m = n.match(RE_LINE);
  if (m) return 'бb'.includes(n[0].toLowerCase()) ? 'over' : 'under';
  return 'other';
}

function parseOuLine(name: string): number | null {
  const m = (name || '').trim().match(/^[бмbmu]\s*([+-]?\d+(?:[.,]\d+)?)$/i);
  if (!m) return null;
  return lineNum(m[1]);
}

export function normalizeCategories(
  categories: RawCategory[],
  opts: { team1?: string; team2?: string } = {},
): NormalizedMarket[] {
  const team1 = opts.team1 ?? '';
  const team2 = opts.team2 ?? '';
  const out: NormalizedMarket[] = [];

  for (const cat of categories) {
    const title = String(cat.title || '').trim();
    if (!title) continue;
    const group = String(cat.group || '').trim();
    const mtype = detectType(title);
    const [team, teamSide] = detectTeam(title, team1, team2);
    const period = detectPeriod(title);

    if (mtype === 'total') {
      out.push(
        ...normalizeTotal({
          title,
          group,
          period,
          team,
          teamSide,
          rows: cat.rows || [],
        }),
      );
      continue;
    }

    if (
      ['1x2', 'moneyline', 'both_to_score', 'win_rest', 'game_end', 'race'].includes(
        mtype,
      )
    ) {
      out.push(
        ...normalizeOutcomeRows({
          title,
          group,
          mtype,
          period,
          team,
          teamSide,
          rows: cat.rows || [],
          team1,
          team2,
        }),
      );
      continue;
    }

    if (mtype === 'handicap') {
      out.push(
        ...normalizeHandicap({
          title,
          group,
          period,
          team,
          teamSide,
          rows: cat.rows || [],
          team1,
          team2,
        }),
      );
      continue;
    }

    for (const row of cat.rows || []) {
      const rowLabel = String(row.label || '').trim();
      const outcomes: MarketOutcome[] = [];
      for (const s of row.selections || []) {
        const odd = f(s.odd);
        const name = String(s.name || '').trim();
        if (odd == null && !name) continue;
        outcomes.push({ key: selectionKey(name), label: name, odd });
      }
      if (!outcomes.length) continue;
      out.push({
        name: title,
        type: mtype,
        group,
        period: detectPeriod(title, rowLabel),
        team,
        team_side: teamSide,
        row: rowLabel !== title ? rowLabel || null : null,
        line: null,
        outcomes,
      });
    }
  }

  return out;
}

function normalizeTotal(args: {
  title: string;
  group: string;
  period: string;
  team: string | null;
  teamSide: string | null;
  rows: RawRow[];
}): NormalizedMarket[] {
  const byPeriodLine = new Map<string, NormalizedMarket>();
  const order: string[] = [];

  for (const row of args.rows) {
    const rowLabel = String(row.label || '').trim();
    const rowPeriod = detectPeriod(args.title, rowLabel);
    let rowDir: 'over' | 'under' | null = null;
    const rl = rowLabel.toLowerCase();
    if (rl.includes('больше') || rl === 'б' || rl === 'over') rowDir = 'over';
    else if (rl.includes('меньше') || rl === 'м' || rl === 'under') rowDir = 'under';

    for (const s of row.selections || []) {
      const name = String(s.name || '').trim();
      const odd = f(s.odd);
      if (odd == null) continue;
      const line = parseOuLine(name);
      const direction = rowDir || selectionKey(name);
      if (line == null || (direction !== 'over' && direction !== 'under')) continue;
      const key = `${rowPeriod}|${line}`;
      let slot = byPeriodLine.get(key);
      if (!slot) {
        slot = {
          name: args.title,
          type: 'total',
          group: args.group,
          period: rowPeriod,
          team: args.team,
          team_side: args.teamSide,
          row: null,
          line,
          over: null,
          under: null,
          outcomes: [],
        };
        byPeriodLine.set(key, slot);
        order.push(key);
      }
      if (direction === 'over') slot.over = odd;
      else slot.under = odd;
    }
  }

  return order.map((key) => {
    const slot = byPeriodLine.get(key)!;
    const outcomes: MarketOutcome[] = [];
    if (slot.over != null) outcomes.push({ key: 'over', label: 'Больше', odd: slot.over });
    if (slot.under != null) outcomes.push({ key: 'under', label: 'Меньше', odd: slot.under });
    slot.outcomes = outcomes;
    return slot;
  });
}

function normalizeOutcomeRows(args: {
  title: string;
  group: string;
  mtype: string;
  period: string;
  team: string | null;
  teamSide: string | null;
  rows: RawRow[];
  team1: string;
  team2: string;
}): NormalizedMarket[] {
  const result: NormalizedMarket[] = [];
  for (const row of args.rows) {
    const rowLabel = String(row.label || '').trim();
    const outcomes: MarketOutcome[] = [];
    let home: number | null = null;
    let draw: number | null = null;
    let away: number | null = null;
    let yes: number | null = null;
    let no: number | null = null;

    for (const s of row.selections || []) {
      let name = String(s.name || '').trim();
      const odd = f(s.odd);
      let key = selectionKey(name);
      if (key === 'other' && name) {
        const nn = normName(name);
        if (nn === normName(args.team1)) {
          key = 'home';
          name = 'П1';
        } else if (nn === normName(args.team2)) {
          key = 'away';
          name = 'П2';
        }
      }
      outcomes.push({ key, label: name, odd });
      if (key === 'home') home = odd;
      else if (key === 'away') away = odd;
      else if (key === 'draw') draw = odd;
      else if (key === 'yes') yes = odd;
      else if (key === 'no') no = odd;
    }
    if (!outcomes.length) continue;
    const item: NormalizedMarket = {
      name: args.title,
      type: args.mtype,
      group: args.group,
      period: rowLabel ? detectPeriod(args.title, rowLabel) : args.period,
      team: args.team,
      team_side: args.teamSide,
      row: rowLabel && rowLabel !== args.title ? rowLabel : null,
      line: null,
      outcomes,
    };
    if (['1x2', 'moneyline', 'win_rest'].includes(args.mtype)) {
      item.home = home;
      item.draw = draw;
      item.away = away;
    }
    if (['both_to_score', 'game_end'].includes(args.mtype)) {
      item.yes = yes;
      item.no = no;
    }
    result.push(item);
  }
  return result;
}

function normalizeHandicap(args: {
  title: string;
  group: string;
  period: string;
  team: string | null;
  teamSide: string | null;
  rows: RawRow[];
  team1: string;
  team2: string;
}): NormalizedMarket[] {
  const buckets = new Map<string, NormalizedMarket>();
  const order: string[] = [];

  for (const row of args.rows) {
    const rowLabel = String(row.label || '').trim();
    const rowPeriod = detectPeriod(args.title, rowLabel);
    let rowSide: 'home' | 'away' | null = null;
    if (normName(rowLabel) === normName(args.team1)) rowSide = 'home';
    else if (normName(rowLabel) === normName(args.team2)) rowSide = 'away';

    for (const s of row.selections || []) {
      const name = String(s.name || '').trim();
      const odd = f(s.odd);
      if (odd == null) continue;
      const m = name.match(/^([+−\-–]?\d+(?:[.,]\d+)?)$/);
      if (!m) continue;
      const ln = lineNum(m[1]);
      if (ln == null) continue;
      const key = `${rowPeriod}|${Math.abs(ln)}`;
      let slot = buckets.get(key);
      if (!slot) {
        slot = {
          name: args.title,
          type: 'handicap',
          group: args.group,
          period: rowPeriod,
          team: args.team,
          team_side: args.teamSide,
          row: null,
          line: ln,
          home: null,
          away: null,
          outcomes: [],
        };
        buckets.set(key, slot);
        order.push(key);
      }
      const side = rowSide ?? (ln <= 0 ? 'home' : 'away');
      if (side === 'home') {
        slot.home = odd;
        slot.line = ln <= 0 ? ln : -Math.abs(ln);
      } else {
        slot.away = odd;
      }
    }
  }

  return order.map((key) => {
    const slot = buckets.get(key)!;
    const outcomes: MarketOutcome[] = [];
    if (slot.home != null) outcomes.push({ key: 'home', label: 'П1', odd: slot.home });
    if (slot.away != null) outcomes.push({ key: 'away', label: 'П2', odd: slot.away });
    slot.outcomes = outcomes;
    return slot;
  });
}

export function buildEventPayload(args: {
  eventId: number;
  team1: string;
  team2: string;
  isLive: boolean;
  href: string;
  source: string;
  categories: RawCategory[];
  suspended?: boolean;
}) {
  const markets = normalizeCategories(args.categories, {
    team1: args.team1,
    team2: args.team2,
  });
  const eid = args.eventId;
  const fresh =
    markets.length > 0 && args.source === 'html' && !args.suspended;
  return {
    event_id: eid,
    winline_event_id: eid,
    league: 'MLB',
    team1: args.team1,
    team2: args.team2,
    is_live: Boolean(args.isLive),
    href: args.href || `/stavki/event/${eid}`,
    url: `https://winline.ru/stavki/sport/bejsbol/ssha/mlb/${eid}`,
    source: args.source,
    fresh,
    ok: fresh,
    market_count: markets.length,
    markets: fresh ? markets : [],
  };
}
