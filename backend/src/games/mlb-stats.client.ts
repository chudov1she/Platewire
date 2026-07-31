export type MlbScheduleResponse = {
  dates?: Array<{
    date: string;
    games?: MlbScheduleGame[];
  }>;
};

export type MlbScheduleGame = {
  gamePk: number;
  gameDate: string;
  officialDate: string;
  rescheduleDate?: string;
  rescheduleGameDate?: string;
  season?: string;
  status?: {
    abstractGameState?: string;
    detailedState?: string;
    statusCode?: string;
  };
  teams?: {
    home?: MlbScheduleSide;
    away?: MlbScheduleSide;
  };
  venue?: {
    id?: number;
    name?: string;
  };
  dayNight?: string;
  scheduledInnings?: number;
};

export type MlbScheduleSide = {
  score?: number;
  team?: {
    id: number;
    name: string;
    abbreviation?: string;
    teamName?: string;
    locationName?: string;
  };
  probablePitcher?: {
    id?: number;
    fullName?: string;
  };
};

export type MlbFeedOfficial = {
  official?: { id?: number; fullName?: string; link?: string };
  officialType?: string;
};

export type MlbLiveFeedResponse = {
  gameData?: {
    datetime?: { dateTime?: string };
    status?: {
      abstractGameState?: string;
      detailedState?: string;
      statusCode?: string;
    };
    weather?: {
      condition?: string;
      temp?: string;
      wind?: string;
    };
    venue?: {
      id?: number;
      name?: string;
      location?: {
        city?: string;
        state?: string;
        country?: string;
        defaultCoordinates?: { latitude?: number; longitude?: number };
      };
    };
    officials?: MlbFeedOfficial[];
    probablePitchers?: {
      home?: { id?: number; fullName?: string };
      away?: { id?: number; fullName?: string };
    };
  };
  liveData?: {
    linescore?: {
      currentInning?: number;
      inningHalf?: string;
      inningState?: string;
      balls?: number;
      strikes?: number;
      outs?: number;
      teams?: {
        home?: { runs?: number };
        away?: { runs?: number };
      };
      /** Per-inning runs — needed to settle F5 bets after the 6th. */
      innings?: Array<{
        num?: number;
        ordinalNum?: string;
        home?: { runs?: number | null };
        away?: { runs?: number | null };
      }>;
    };
    boxscore?: {
      officials?: MlbFeedOfficial[];
    };
  };
};

const MLB_BASE = 'https://statsapi.mlb.com';

export class MlbStatsClient {
  async fetchSchedule(date: string): Promise<MlbScheduleResponse> {
    const url = new URL(`${MLB_BASE}/api/v1/schedule`);
    url.searchParams.set('sportId', '1');
    url.searchParams.set('date', date);
    url.searchParams.set('hydrate', 'team,venue,linescore,probablePitcher');
    return this.getJson<MlbScheduleResponse>(url);
  }

  async fetchLiveFeed(gamePk: number): Promise<MlbLiveFeedResponse> {
    const url = new URL(`${MLB_BASE}/api/v1.1/game/${gamePk}/feed/live`);
    return this.getJson<MlbLiveFeedResponse>(url);
  }

  async fetchVenue(mlbVenueId: number): Promise<{
    venues?: Array<{
      id?: number;
      name?: string;
      location?: {
        city?: string;
        state?: string;
        stateAbbrev?: string;
        country?: string;
        defaultCoordinates?: { latitude?: number; longitude?: number };
      };
    }>;
  }> {
    const url = new URL(`${MLB_BASE}/api/v1/venues/${mlbVenueId}`);
    url.searchParams.set('hydrate', 'location');
    return this.getJson(url);
  }

  private async getJson<T>(url: URL): Promise<T> {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(
        `MLB API ${response.status} ${response.statusText} for ${url.toString()}`,
      );
    }
    return (await response.json()) as T;
  }
}

export function normalizeGameStatus(
  abstractGameState?: string,
  detailedState?: string,
): string {
  const abstract = (abstractGameState ?? '').toLowerCase();
  const detailed = (detailedState ?? '').toLowerCase();

  if (
    detailed.includes('postponed') ||
    detailed.includes('cancelled') ||
    detailed.includes('canceled') ||
    detailed.includes('suspended')
  ) {
    return 'OTHER';
  }
  if (abstract === 'live' || detailed.includes('in progress')) {
    return 'LIVE';
  }
  if (
    abstract === 'final' ||
    detailed.includes('final') ||
    detailed.includes('completed') ||
    detailed.includes('game over')
  ) {
    return 'FINAL';
  }
  if (
    abstract === 'preview' ||
    detailed.includes('pre-game') ||
    detailed.includes('scheduled') ||
    detailed.includes('warmup')
  ) {
    return 'PREVIEW';
  }
  return abstract ? abstract.toUpperCase() : 'OTHER';
}
