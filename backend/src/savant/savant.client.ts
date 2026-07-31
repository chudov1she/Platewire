export const BASEBALL_SAVANT_BASE_URL = 'https://baseballsavant.mlb.com';

export type SavantPreviewTeams = {
  home?: SavantPreviewSide;
  away?: SavantPreviewSide;
  [key: string]: unknown;
};

export type SavantPreviewSide = {
  hasLineup?: boolean;
  hasProbable?: boolean;
  team?: { id?: number; name?: string };
  roster?: {
    hitters?: SavantPreviewPlayer[];
    pitchers?: SavantPreviewPlayer[];
    catchers?: SavantPreviewPlayer[];
  };
  [key: string]: unknown;
};

export type SavantPreviewPlayer = {
  person?: { id?: number; fullName?: string };
  battingOrder?: string | number | null;
  xwoba?: string | number | null;
  xslg?: string | number | null;
  xba?: string | number | null;
  barrel_batted_rate?: string | number | null;
  hard_hit_percent?: string | number | null;
  seasonStats?: {
    pitching?: {
      era?: string | number | null;
      whip?: string | number | null;
      gamesStarted?: string | number | null;
    };
  };
  ff_avg_speed?: string | number | null;
  [key: string]: unknown;
};

export type SavantPreviewSummary = {
  home: SavantPreviewSideSummary;
  away: SavantPreviewSideSummary;
};

export type SavantPreviewSideSummary = {
  has_lineup: boolean;
  has_probable: boolean;
  team_id: number | null;
  lineup: Array<{
    mlb_player_id: number | null;
    full_name: string | null;
    batting_order: number;
    xwoba: number | null;
    xslg: number | null;
    xba: number | null;
    barrel_batted_rate: number | null;
    hard_hit_percent: number | null;
  }>;
  pitchers: Array<{
    mlb_player_id: number | null;
    full_name: string | null;
    era: number | null;
    whip: number | null;
    xwoba: number | null;
    games_started: number | null;
    ff_avg_speed: number | null;
  }>;
};

export type SavantGamefeedPayload = Record<string, unknown>;

export class BaseballSavantClient {
  async fetchPreviewHtml(gamePk: number, gameDate: string): Promise<string> {
    const url = new URL(`${BASEBALL_SAVANT_BASE_URL}/preview`);
    url.searchParams.set('game_pk', String(gamePk));
    url.searchParams.set('game_date', gameDate);
    const res = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent':
          'Mozilla/5.0 (compatible; Platewire/0.1; +local-dev)',
      },
    });
    if (!res.ok) {
      throw new Error(`Savant preview HTTP ${res.status} for ${gamePk}`);
    }
    return res.text();
  }

  async fetchGamefeed(gamePk: number): Promise<SavantGamefeedPayload> {
    const url = new URL(`${BASEBALL_SAVANT_BASE_URL}/gf`);
    url.searchParams.set('game_pk', String(gamePk));
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (compatible; Platewire/0.1; +local-dev)',
      },
    });
    if (!res.ok) {
      throw new Error(`Savant gamefeed HTTP ${res.status} for ${gamePk}`);
    }
    return (await res.json()) as SavantGamefeedPayload;
  }

  async fetchStatcastCsv(gamePk: number): Promise<string> {
    const url = new URL(`${BASEBALL_SAVANT_BASE_URL}/statcast_search/csv`);
    url.searchParams.set('all', 'true');
    url.searchParams.set('type', 'details');
    url.searchParams.set('game_pk', String(gamePk));
    const res = await fetch(url, {
      headers: {
        Accept: 'text/csv,application/download,*/*',
        'User-Agent':
          'Mozilla/5.0 (compatible; Platewire/0.1; +local-dev)',
        Referer: `https://baseballsavant.mlb.com/statcast_search?game_pk=${gamePk}`,
      },
    });
    if (!res.ok) {
      throw new Error(`Savant statcast CSV HTTP ${res.status} for ${gamePk}`);
    }
    return res.text();
  }
}

export function extractTeamsJson(html: string): SavantPreviewTeams {
  const marker = 'var teams = ';
  const start = html.indexOf(marker);
  if (start < 0) {
    throw new Error('Savant preview teams JSON marker not found');
  }
  let depth = 0;
  const payloadStart = start + marker.length;
  for (let i = payloadStart; i < html.length; i += 1) {
    const char = html[i];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const payload = JSON.parse(html.slice(payloadStart, i + 1)) as unknown;
        if (!payload || typeof payload !== 'object') {
          throw new Error('Savant preview teams JSON must be an object');
        }
        return payload as SavantPreviewTeams;
      }
    }
  }
  throw new Error('Savant preview teams JSON is unterminated');
}

export function parseBattingOrder(
  value: string | number | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+$/.test(text) && text.length >= 3) {
    const order = Number(text[0]);
    return order >= 1 && order <= 9 ? order : null;
  }
  const match = text.match(/^(\d+)/);
  if (!match) return null;
  const order = Number(match[1]);
  return order >= 1 && order <= 9 ? order : null;
}

export function floatOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (value === '' || value === '-' || value === '--' || value === '-.--') {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value).trim().replace(/^\./, '0.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function intOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(String(value).trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function summarizePreviewTeams(
  teams: SavantPreviewTeams,
): SavantPreviewSummary {
  const summary: SavantPreviewSummary = {
    home: emptySideSummary(),
    away: emptySideSummary(),
  };

  for (const side of ['home', 'away'] as const) {
    const block = (teams[side] ?? {}) as SavantPreviewSide;
    const hitters = block.roster?.hitters ?? [];
    const pitchers = block.roster?.pitchers ?? [];
    const lineup = [];
    for (const hitter of hitters) {
      const order = parseBattingOrder(hitter.battingOrder);
      if (order === null) continue;
      const person = hitter.person ?? {};
      lineup.push({
        mlb_player_id: intOrNull(person.id),
        full_name: person.fullName ?? null,
        batting_order: order,
        xwoba: floatOrNull(hitter.xwoba),
        xslg: floatOrNull(hitter.xslg),
        xba: floatOrNull(hitter.xba),
        barrel_batted_rate: floatOrNull(hitter.barrel_batted_rate),
        hard_hit_percent: floatOrNull(hitter.hard_hit_percent),
      });
    }
    lineup.sort((a, b) => a.batting_order - b.batting_order);

    const pitcherRows = pitchers.map((pitcher) => {
      const person = pitcher.person ?? {};
      const season = pitcher.seasonStats?.pitching ?? {};
      return {
        mlb_player_id: intOrNull(person.id),
        full_name: person.fullName ?? null,
        era: floatOrNull(season.era),
        whip: floatOrNull(season.whip),
        xwoba: floatOrNull(pitcher.xwoba),
        games_started: intOrNull(season.gamesStarted),
        ff_avg_speed: floatOrNull(pitcher.ff_avg_speed),
      };
    });

    summary[side] = {
      has_lineup: Boolean(block.hasLineup),
      has_probable: Boolean(block.hasProbable),
      team_id: intOrNull(block.team?.id),
      lineup,
      pitchers: pitcherRows,
    };
  }

  return summary;
}

function emptySideSummary(): SavantPreviewSideSummary {
  return {
    has_lineup: false,
    has_probable: false,
    team_id: null,
    lineup: [],
    pitchers: [],
  };
}

/** Prefer nested `stats`; else collect known flat keys (live Savant shape). */
export function savantStatsPayload(
  data: SavantGamefeedPayload,
): Record<string, unknown> | null {
  const nested = data.stats;
  if (nested && typeof nested === 'object') {
    return nested as Record<string, unknown>;
  }

  const keys = [
    'wpa',
    'exitVelocity',
    'exit_velocity',
    'pitchVelocity',
    'pitch_velocity',
    'boxscore',
    'players',
    'home_batters',
    'away_batters',
    'home_pitchers',
    'away_pitchers',
    'home_lineup',
    'away_lineup',
    'home_pitcher_lineup',
    'away_pitcher_lineup',
  ];
  const payload: Record<string, unknown> = {};
  for (const key of keys) {
    if (data[key] !== undefined && data[key] !== null) {
      payload[key] = data[key];
    }
  }
  return Object.keys(payload).length > 0 ? payload : null;
}

export function normalizeSavantPlayerName(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  if (text.includes(',')) {
    const [last, first] = text.split(',').map((part) => part.trim());
    if (first && last) return `${first} ${last}`;
  }
  return text;
}
