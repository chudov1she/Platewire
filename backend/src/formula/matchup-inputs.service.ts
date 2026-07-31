import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CONTEXT_HITTER_L5_MIN_GAMES,
  CONTEXT_PITCHER_L5_MIN_GAMES,
} from '../common/context.constants.js';
import { UmpScorecardsService } from '../context/ump-scorecards.service.js';
import {
  elapsedF5Innings,
  f5IsComplete,
  f5WindowActive,
} from '../odds/f5-scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SavantPreviewSummary } from '../savant/savant.client.js';
import {
  LEAGUE_ERA,
  LEAGUE_OPS,
  defaultTeamInputs,
  type InputSource,
  type LiveF5State,
  type MatchupInputs,
  type TeamInputs,
} from './formula.types.js';

export type MatchupContextFlags = {
  hasLineup: boolean;
  hasHomeSp: boolean;
  hasAwaySp: boolean;
};

export type MatchupBuildResult = {
  inputs: MatchupInputs;
  notes: string[];
  input_sources: Record<string, InputSource>;
  context: MatchupContextFlags;
};

/**
 * Builds the v42 MatchupInputs dossier purely from platewire's own data
 * plane (context/PlayerFeature/OfficialFeature/WeatherObservation) — no
 * dependency on any other project.
 */
@Injectable()
export class MatchupInputsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly umpScorecards: UmpScorecardsService,
  ) {}

  async build(gameId: string): Promise<MatchupBuildResult> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        venue: true,
        lineupPlayers: {
          orderBy: [{ side: 'asc' }, { battingOrder: 'asc' }],
        },
        gameOfficials: {
          include: { official: { include: { features: true } } },
        },
        savantPreview: { select: { summaryJson: true, hasLineup: true } },
      },
    });
    if (!game) throw new NotFoundException('Game not found');

    const season = game.season ?? new Date().getUTCFullYear();
    const notes: string[] = [];
    const input_sources: Record<string, InputSource> = {};

    const summary = (game.savantPreview?.summaryJson ??
      null) as SavantPreviewSummary | null;

    const homePitcherId = resolveStartingPitcherId(
      game.homeProbableMlbId,
      summary?.home?.pitchers,
    );
    const awayPitcherId = resolveStartingPitcherId(
      game.awayProbableMlbId,
      summary?.away?.pitchers,
    );
    const homeLineup = game.lineupPlayers.filter((p) => p.side === 'home');
    const awayLineup = game.lineupPlayers.filter((p) => p.side === 'away');
    const hasLineup =
      (homeLineup.length > 0 && awayLineup.length > 0) ||
      game.savantPreview?.hasLineup === true;

    const lineupIds = game.lineupPlayers
      .map((r) => r.mlbPlayerId)
      .filter((x): x is number => typeof x === 'number');
    const pitcherIds = [homePitcherId, awayPitcherId].filter(
      (x): x is number => typeof x === 'number',
    );

    const hitterFeatures = await this.prisma.playerFeature.findMany({
      where: { mlbPlayerId: { in: lineupIds }, role: 'hitter', season },
    });
    const pitcherFeatures = await this.prisma.playerFeature.findMany({
      where: { mlbPlayerId: { in: pitcherIds }, role: 'pitcher', season },
    });

    const home = this.buildSide(
      'home',
      homeLineup,
      hitterFeatures,
      pitcherFeatures.find((f) => f.mlbPlayerId === homePitcherId),
      notes,
      input_sources,
    );
    const away = this.buildSide(
      'away',
      awayLineup,
      hitterFeatures,
      pitcherFeatures.find((f) => f.mlbPlayerId === awayPitcherId),
      notes,
      input_sources,
    );

    const openMeteo = await this.pickOpenMeteoWeather(gameId, game.gameDateUtc);
    const mlbWeather = parseMlbWeather(game.weatherTemp, game.weatherWind);
    const weather = {
      temperature_f: openMeteo?.temperature_f ?? mlbWeather.temperature_f,
      humidity: openMeteo?.humidity ?? mlbWeather.humidity,
      wind_speed_mph: openMeteo?.wind_speed_mph ?? mlbWeather.wind_speed_mph,
      wind_direction_deg:
        openMeteo?.wind_direction_deg ?? mlbWeather.wind_direction_deg,
    };
    if (weather.temperature_f == null) {
      notes.push('weather_neutral');
      input_sources.temperature_f = { value: 72, source: 'default' };
    } else {
      input_sources.temperature_f = {
        value: weather.temperature_f,
        source: openMeteo ? 'open_meteo' : 'mlb_weather',
      };
    }
    if (weather.humidity != null) {
      input_sources.humidity = {
        value: weather.humidity,
        source: openMeteo ? 'open_meteo' : 'mlb_weather',
      };
    }
    if (weather.wind_speed_mph != null) {
      input_sources.wind_speed_mph = {
        value: weather.wind_speed_mph,
        source: openMeteo ? 'open_meteo' : 'mlb_weather',
      };
    }

    const hp = game.gameOfficials.find((o) => o.role === 'Home Plate');
    let umpStrike: number | null = null;
    if (hp?.official.features?.calledStrikeRate != null) {
      umpStrike = hp.official.features.calledStrikeRate;
      input_sources.ump_strike_zone_pct = {
        value: umpStrike,
        source: 'feature',
        ready: hp.official.features.ready,
      };
    } else {
      notes.push('ump_default');
      input_sources.ump_strike_zone_pct = {
        value: null,
        source: 'default',
        ready: false,
      };
    }

    const scorecard = hp
      ? await this.umpScorecards.resolveForOfficial({
          umpScorecardName: hp.official.umpScorecardName,
          fullName: hp.official.fullName,
        })
      : null;
    const umpAccuracyAboveX = scorecard?.accuracy_above_x ?? null;
    const umpConsistency = scorecard?.consistency ?? null;
    const umpFavorAbs = scorecard?.favor_abs_mean ?? null;
    const umpRunImpact = scorecard?.total_run_impact_mean ?? null;
    if (scorecard) {
      input_sources.ump_accuracy_above_x = {
        value: umpAccuracyAboveX,
        source: 'umpscorecards',
        ready: scorecard.games_sample >= 15,
      };
      input_sources.ump_consistency = {
        value: umpConsistency,
        source: 'umpscorecards',
        ready: scorecard.games_sample >= 15,
      };
    }

    const live = this.buildLive(game);
    if (live) {
      input_sources.live_completed_innings = {
        value: live.completed_innings,
        source: 'game',
      };
    }

    const seed = hashSeed(game.mlbGamePk);
    const inputs: MatchupInputs = {
      home,
      away,
      venue: game.venue?.name ?? null,
      temperature_f: weather.temperature_f,
      humidity: weather.humidity,
      wind_speed_mph: weather.wind_speed_mph,
      wind_direction_deg: weather.wind_direction_deg,
      day_night: game.dayNight,
      ump_strike_zone_pct: umpStrike,
      ump_accuracy_above_x: umpAccuracyAboveX,
      ump_consistency: umpConsistency,
      ump_favor_abs: umpFavorAbs,
      ump_run_impact: umpRunImpact,
      live,
      seed,
    };

    return {
      inputs,
      notes,
      input_sources,
      context: {
        hasLineup,
        hasHomeSp: homePitcherId != null,
        hasAwaySp: awayPitcherId != null,
      },
    };
  }

  private buildSide(
    side: 'home' | 'away',
    lineup: Array<{
      mlbPlayerId: number | null;
      barrelRate: number | null;
      hardHitPct: number | null;
    }>,
    hitterFeatures: Array<{
      mlbPlayerId: number;
      ready: boolean;
      seasonOps: number | null;
      l5Ops: number | null;
      l5Games: number;
    }>,
    pitcher:
      | {
          ready: boolean;
          seasonEra: number | null;
          l5Era: number | null;
          l5Games: number;
          seasonIp: number | null;
          seasonGamesStarted: number | null;
        }
      | undefined,
    notes: string[],
    sources: Record<string, InputSource>,
  ): TeamInputs {
    const team = defaultTeamInputs();
    const opsValues: number[] = [];
    const l5Values: number[] = [];
    let barrelSum = 0;
    let barrelN = 0;
    let hardHitSum = 0;
    let hardHitN = 0;

    for (const slot of lineup) {
      if (slot.barrelRate != null) {
        barrelSum += slot.barrelRate;
        barrelN += 1;
      }
      if (slot.hardHitPct != null) {
        hardHitSum += slot.hardHitPct;
        hardHitN += 1;
      }
      if (slot.mlbPlayerId == null) continue;
      const feat = hitterFeatures.find(
        (f) => f.mlbPlayerId === slot.mlbPlayerId,
      );
      if (!feat) continue;
      if (feat.ready && feat.seasonOps != null) {
        opsValues.push(feat.seasonOps);
      } else if (feat.l5Ops != null && feat.l5Games >= CONTEXT_HITTER_L5_MIN_GAMES) {
        opsValues.push(feat.l5Ops);
      }
      if (feat.l5Ops != null && feat.l5Games >= CONTEXT_HITTER_L5_MIN_GAMES) {
        l5Values.push(feat.l5Ops);
      }
    }

    if (opsValues.length) {
      team.ops = mean(opsValues);
      sources[`${side}_ops`] = { value: team.ops, source: 'feature', ready: true };
    } else {
      team.ops = LEAGUE_OPS;
      notes.push(`${side}_ops_default`);
      sources[`${side}_ops`] = { value: LEAGUE_OPS, source: 'default', ready: false };
    }

    if (l5Values.length) {
      const meanL5 = mean(l5Values);
      team.offense_trend = meanL5 / Math.max(0.01, team.ops);
      sources[`${side}_form_l5_ops`] = {
        value: meanL5,
        source: 'feature',
        ready: true,
      };
    }

    if (barrelN) team.barrel_pct = barrelSum / barrelN;
    if (hardHitN) team.hardhit_pct = hardHitSum / hardHitN;

    if (pitcher?.seasonEra != null && pitcher.ready) {
      team.sp_era = pitcher.seasonEra;
      sources[`${side}_sp_era`] = { value: team.sp_era, source: 'feature', ready: true };
    } else if (
      pitcher?.l5Era != null &&
      pitcher.l5Games >= CONTEXT_PITCHER_L5_MIN_GAMES
    ) {
      team.sp_era = pitcher.l5Era;
      sources[`${side}_sp_era`] = { value: team.sp_era, source: 'feature', ready: true };
    } else {
      team.sp_era = LEAGUE_ERA;
      notes.push(`${side}_sp_era_default`);
      sources[`${side}_sp_era`] = { value: LEAGUE_ERA, source: 'default', ready: false };
    }

    if (pitcher?.l5Era != null && pitcher.l5Games >= CONTEXT_PITCHER_L5_MIN_GAMES) {
      team.sp_era_last7 = pitcher.l5Era;
    }
    if (pitcher?.seasonIp != null && pitcher.seasonGamesStarted) {
      team.sp_ip_avg = pitcher.seasonIp / Math.max(1, pitcher.seasonGamesStarted);
    }

    return team;
  }

  private buildLive(game: {
    status: string;
    inning: number | null;
    inningHalf: string | null;
    homeScore: number | null;
    awayScore: number | null;
  }): LiveF5State | null {
    if (!f5WindowActive(game.inning, game.inningHalf)) return null;
    const elapsed = elapsedF5Innings(game.inning, game.inningHalf);
    if (elapsed <= 0) return null;
    return {
      completed_innings: elapsed,
      home_score: game.homeScore ?? 0,
      away_score: game.awayScore ?? 0,
      inning: game.inning,
      inning_half: game.inningHalf,
      f5_complete: f5IsComplete(game.inning, game.inningHalf),
    };
  }

  /** Prefer live_window Open-Meteo row, else nearest pregame, else nearest overall. */
  private async pickOpenMeteoWeather(
    gameId: string,
    gameDateUtc: Date,
  ): Promise<{
    temperature_f: number | null;
    humidity: number | null;
    wind_speed_mph: number | null;
    wind_direction_deg: number | null;
  } | null> {
    const rows = await this.prisma.weatherObservation.findMany({
      where: { gameId, source: 'open_meteo' },
      orderBy: { observedAt: 'asc' },
    });
    if (!rows.length) return null;
    const live = rows.find((r) => r.relativeToGame === 'live_window');
    const pregame = [...rows]
      .reverse()
      .find((r) => r.relativeToGame === 'pregame');
    const nearest = rows.reduce((best, row) => {
      const d = Math.abs(row.observedAt.getTime() - gameDateUtc.getTime());
      const bd = Math.abs(best.observedAt.getTime() - gameDateUtc.getTime());
      return d < bd ? row : best;
    }, rows[0]!);
    const pick = live ?? pregame ?? nearest;
    return {
      temperature_f: pick.temperatureF,
      humidity: pick.humidity,
      wind_speed_mph: pick.windSpeedMph,
      wind_direction_deg: pick.windDirectionDeg,
    };
  }
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function hashSeed(mlbGamePk: number): number {
  let x = mlbGamePk | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

function parseMlbWeather(
  temp: string | null | undefined,
  wind: string | null | undefined,
): {
  temperature_f: number | null;
  humidity: number | null;
  wind_speed_mph: number | null;
  wind_direction_deg: number | null;
} {
  let temperature_f: number | null = null;
  if (temp) {
    const m = temp.match(/(-?\d+(?:\.\d)?)/);
    if (m) temperature_f = Number(m[1]);
  }
  let wind_speed_mph: number | null = null;
  let wind_direction_deg: number | null = null;
  if (wind) {
    const speed = wind.match(/(\d+)\s*mph/i);
    if (speed) wind_speed_mph = Number(speed[1]);
    const lower = wind.toLowerCase();
    if (lower.includes('out')) wind_direction_deg = 0;
    else if (lower.includes('in')) wind_direction_deg = 180;
    else if (lower.includes('l') || lower.includes('left'))
      wind_direction_deg = 270;
    else if (lower.includes('r') || lower.includes('right'))
      wind_direction_deg = 90;
  }
  return { temperature_f, humidity: null, wind_speed_mph, wind_direction_deg };
}

/**
 * Prefer MLB probable SP id. Fall back to Savant roster pitcher with ERA +
 * most games started — never blindly pitchers[0] (often a no-stats call-up).
 */
export function resolveStartingPitcherId(
  probableMlbId: number | null | undefined,
  pitchers:
    | Array<{
        mlb_player_id: number | null;
        era: number | null;
        games_started: number | null;
      }>
    | null
    | undefined,
): number | null {
  if (probableMlbId != null && Number.isFinite(probableMlbId)) {
    return probableMlbId;
  }
  const list = pitchers ?? [];
  const scored = list
    .filter(
      (p) =>
        p.mlb_player_id != null &&
        p.era != null &&
        Number.isFinite(p.era),
    )
    .sort(
      (a, b) => (b.games_started ?? 0) - (a.games_started ?? 0),
    );
  if (scored.length) return scored[0].mlb_player_id;
  return list.find((p) => p.mlb_player_id != null)?.mlb_player_id ?? null;
}
