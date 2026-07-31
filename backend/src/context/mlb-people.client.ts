const MLB_BASE = 'https://statsapi.mlb.com';

export type MlbPerson = {
  id: number;
  fullName?: string;
  birthDate?: string;
  batSide?: { code?: string; description?: string };
  pitchHand?: { code?: string; description?: string };
  primaryPosition?: { abbreviation?: string; name?: string; type?: string };
  currentTeam?: { id?: number; name?: string };
  stats?: MlbPersonStatBlock[];
};

export type MlbPersonStatBlock = {
  type?: { displayName?: string };
  group?: { displayName?: string };
  splits?: Array<{
    season?: string;
    stat?: Record<string, unknown>;
    numTeams?: number;
    date?: string;
    game?: { gamePk?: number };
  }>;
};

export type MlbPeopleResponse = {
  people?: MlbPerson[];
};

export type MlbStatsResponse = {
  stats?: MlbPersonStatBlock[];
};

export type PlayerRole = 'hitter' | 'pitcher';

export type FormWindowMetrics = {
  games: number;
  ops: number | null;
  avg: number | null;
  era: number | null;
  whip: number | null;
  ip: number | null;
  asOf: string | null;
};

export type ParsedPlayerStats = {
  person: MlbPerson;
  season: Record<string, unknown> | null;
  l5: FormWindowMetrics;
  l10: FormWindowMetrics;
};

export class MlbPeopleClient {
  async fetchPersonWithForm(
    personId: number,
    role: PlayerRole,
    season: number,
  ): Promise<MlbPerson | null> {
    const group = role === 'hitter' ? 'hitting' : 'pitching';
    const personUrl = new URL(`${MLB_BASE}/api/v1/people/${personId}`);
    personUrl.searchParams.set(
      'hydrate',
      `currentTeam,stats(group=[${group}],type=[season])`,
    );
    const personPayload = await this.getJson<MlbPeopleResponse>(personUrl);
    const person = personPayload.people?.[0];
    if (!person) return null;

    const logUrl = new URL(`${MLB_BASE}/api/v1/people/${personId}/stats`);
    logUrl.searchParams.set('stats', 'gameLog');
    logUrl.searchParams.set('group', group);
    logUrl.searchParams.set('season', String(season));
    logUrl.searchParams.set('sportId', '1');
    const logPayload = await this.getJson<MlbStatsResponse>(logUrl);
    const gameLogBlocks = logPayload.stats ?? [];

    person.stats = [...(person.stats ?? []), ...gameLogBlocks];
    return person;
  }

  async fetchPersonBio(personId: number): Promise<MlbPerson | null> {
    const url = new URL(`${MLB_BASE}/api/v1/people/${personId}`);
    url.searchParams.set('hydrate', 'currentTeam');
    const payload = await this.getJson<MlbPeopleResponse>(url);
    return payload.people?.[0] ?? null;
  }

  async fetchPeopleBatch(
    personIds: number[],
    role: PlayerRole,
    season: number,
  ): Promise<MlbPerson[]> {
    const unique = [...new Set(personIds)];
    const out: MlbPerson[] = [];
    const concurrency = 5;
    for (let i = 0; i < unique.length; i += concurrency) {
      const chunk = unique.slice(i, i + concurrency);
      const part = await Promise.all(
        chunk.map(async (id) => {
          try {
            return await this.fetchPersonWithForm(id, role, season);
          } catch {
            return null;
          }
        }),
      );
      for (const p of part) {
        if (p) out.push(p);
      }
    }
    return out;
  }

  parsePersonStats(person: MlbPerson, role: PlayerRole): ParsedPlayerStats {
    const groupName = role === 'hitter' ? 'hitting' : 'pitching';
    const blocks = (person.stats ?? []).filter((b) => {
      const g = (b.group?.displayName ?? '').toLowerCase();
      return !g || g === groupName;
    });

    const seasonBlock = blocks.find(
      (b) => (b.type?.displayName ?? '').toLowerCase() === 'season',
    );
    const seasonStat = seasonBlock?.splits?.[0]?.stat ?? null;

    const gameLogBlock = blocks.find((b) => {
      const t = (b.type?.displayName ?? '').toLowerCase();
      return t === 'gamelog' || t === 'game log';
    });
    const splits = [...(gameLogBlock?.splits ?? [])].reverse();

    return {
      person,
      season: seasonStat,
      l5: aggregateWindow(splits.slice(0, 5), role),
      l10: aggregateWindow(splits.slice(0, 10), role),
    };
  }

  private async getJson<T>(url: URL): Promise<T> {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(
        `MLB people API ${response.status} for ${url.toString()}`,
      );
    }
    return (await response.json()) as T;
  }
}

function aggregateWindow(
  splits: Array<{ stat?: Record<string, unknown>; date?: string }>,
  role: PlayerRole,
): FormWindowMetrics {
  if (!splits.length) {
    return {
      games: 0,
      ops: null,
      avg: null,
      era: null,
      whip: null,
      ip: null,
      asOf: null,
    };
  }

  const asOf = splits[0]?.date ?? null;
  let games = 0;
  let ab = 0;
  let h = 0;
  let bb = 0;
  let hbp = 0;
  let sf = 0;
  let tb = 0;
  let er = 0;
  let ipOuts = 0;
  let walks = 0;
  let hitsAllowed = 0;

  for (const split of splits) {
    const s = split.stat ?? {};
    games += 1;
    if (role === 'hitter') {
      ab += num(s.atBats) ?? num(s.ab) ?? 0;
      h += num(s.hits) ?? num(s.h) ?? 0;
      bb += num(s.baseOnBalls) ?? num(s.bb) ?? 0;
      hbp += num(s.hitByPitch) ?? num(s.hbp) ?? 0;
      sf += num(s.sacFlies) ?? num(s.sf) ?? 0;
      const doubles = num(s.doubles) ?? 0;
      const triples = num(s.triples) ?? 0;
      const hrs = num(s.homeRuns) ?? 0;
      const hits = num(s.hits) ?? num(s.h) ?? 0;
      const singles = Math.max(hits - doubles - triples - hrs, 0);
      tb += singles + 2 * doubles + 3 * triples + 4 * hrs;
    } else {
      er += num(s.earnedRuns) ?? num(s.er) ?? 0;
      hitsAllowed += num(s.hits) ?? num(s.h) ?? 0;
      walks += num(s.baseOnBalls) ?? num(s.bb) ?? 0;
      const ip = num(s.inningsPitched) ?? num(s.ip);
      if (ip != null) {
        ipOuts += inningsToOuts(ip);
      }
    }
  }

  if (role === 'hitter') {
    const avg = ab > 0 ? h / ab : null;
    const obpDen = ab + bb + hbp + sf;
    const obp = obpDen > 0 ? (h + bb + hbp) / obpDen : null;
    const slg = ab > 0 ? tb / ab : null;
    const ops = obp != null && slg != null ? round3(obp + slg) : null;
    return {
      games,
      ops,
      avg: avg != null ? round3(avg) : null,
      era: null,
      whip: null,
      ip: null,
      asOf,
    };
  }

  const ip = ipOuts > 0 ? outsToInnings(ipOuts) : null;
  const era = ip != null && ip > 0 ? round2((er * 9) / ip) : null;
  const whip =
    ip != null && ip > 0 ? round2((walks + hitsAllowed) / ip) : null;
  return {
    games,
    ops: null,
    avg: null,
    era,
    whip,
    ip: ip != null ? round1(ip) : null,
    asOf,
  };
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function inningsToOuts(ip: number): number {
  const whole = Math.floor(ip);
  const frac = Math.round((ip - whole) * 10);
  return whole * 3 + frac;
}

function outsToInnings(outs: number): number {
  const whole = Math.floor(outs / 3);
  const rem = outs % 3;
  return whole + rem / 10;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
