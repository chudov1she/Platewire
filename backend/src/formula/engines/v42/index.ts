import { defaultTeamInputs } from '../../formula.types.js';
import {
  buildSideLambda,
  computeLiveLambdas,
  parkTimeFactor,
  umpireUif,
  weatherWif,
  type PitcherProfile,
  type TeamProfile,
} from './v42-lambda.js';
import { evaluateMarkets, VALUE_THRESHOLD } from './v42-markets.js';
import { remainingF5Innings } from '../../../odds/f5-scope.js';
import { isLiveRecalc, simulateF5, simulateLiveF5 } from './v42-simulate.js';
import type {
  After5Analysis,
  MarketLine,
  MatchupInputs,
  TeamInputs,
} from '../../formula.types.js';

export const FORMULA_VERSION = 'v42';

export const PARK_FACTORS: Record<string, number> = {
  'coors field': 1.15,
  'fenway park': 1.05,
  'comerica park': 0.98,
  'oracle park': 0.96,
  'petco park': 0.97,
  'wrigley field': 1.04,
  'yankee stadium': 1.03,
  'great american ball park': 1.06,
};

export {
  buildSideLambda,
  computeLiveLambdas,
  exactPoissonF5,
  poissonPmf,
  weatherWif,
  umpireUif,
  parkTimeFactor,
} from './v42-lambda.js';
export { simulateF5, simulateLiveF5, createRng, samplePoisson } from './v42-simulate.js';
export { evaluateMarkets, americanToDecimal, impliedProb } from './v42-markets.js';

export function parkFactor(
  venueName: string | null | undefined,
  opts?: { coors_chaos?: boolean },
): { factor: number; chaos: number } {
  const key = (venueName || '').toLowerCase();
  let factor = 1;
  for (const [name, value] of Object.entries(PARK_FACTORS)) {
    if (key.includes(name)) {
      factor = value;
      break;
    }
  }
  const chaos =
    opts?.coors_chaos && key.includes('coors') ? 1.2 : 1;
  return { factor, chaos };
}

function toOffenseProfile(t: TeamInputs): TeamProfile {
  return {
    ops: t.ops,
    team_era: t.team_era,
    barrel_pct: t.barrel_pct,
    hardhit_pct: t.hardhit_pct,
    gb_pct: t.lineup_gb_pct ?? t.gb_pct,
    sprint_speed: t.sprint_speed,
    fielding_pct: t.fielding_pct,
    oaa: t.oaa,
    drs: t.drs,
    form_win_pct: t.form_win_pct,
    offense_trend: t.offense_trend,
  };
}

function toPitcherProfile(t: TeamInputs): PitcherProfile {
  return {
    era: t.sp_era,
    fip: t.sp_fip,
    era_last7: t.sp_era_last7,
    ip_avg: t.sp_ip_avg,
    gb_pct: t.gb_pct,
    k_pct: t.sp_k_pct,
    bb_pct: t.sp_bb_pct,
    fps_pct: t.sp_fps_pct,
  };
}

export function buildLambdas(inputs: MatchupInputs): {
  lambda_home: number;
  lambda_away: number;
  chaos: number;
  notes: string[];
  breakdown: Record<string, unknown>;
} {
  const { factor: parkBase, chaos } = parkFactor(inputs.venue, {
    coors_chaos: true,
  });
  const parkTime = parkTimeFactor({
    venue: inputs.venue,
    day_night: inputs.day_night,
    park_base: parkBase,
  });
  const weather = weatherWif({
    temperature_f: inputs.temperature_f,
    humidity: inputs.humidity,
    wind_speed_mph: inputs.wind_speed_mph,
    wind_direction_deg: inputs.wind_direction_deg,
  });
  let ump = umpireUif(
    inputs.ump_strike_zone_pct,
    inputs.ump_accuracy_above_x,
  );
  if (
    inputs.ump_strike_zone_pct == null &&
    inputs.ump_accuracy_above_x == null &&
    (inputs.ump_pitcher_bias ?? 1) !== 1
  ) {
    ump = inputs.ump_pitcher_bias ?? 1;
  }

  const homeOffense = toOffenseProfile(inputs.home);
  const awayOffense = toOffenseProfile(inputs.away);
  const homePitcher = toPitcherProfile(inputs.home);
  const awayPitcher = toPitcherProfile(inputs.away);

  const homeSide = buildSideLambda({
    offense: homeOffense,
    defense: awayOffense,
    opposing_pitcher: awayPitcher,
    park_time: parkTime,
    weather_factor: weather,
    ump_factor: ump,
    h2h_edge: inputs.h2h_home_edge ?? 1,
  });
  const awaySide = buildSideLambda({
    offense: awayOffense,
    defense: homeOffense,
    opposing_pitcher: homePitcher,
    park_time: parkTime,
    weather_factor: weather,
    ump_factor: ump,
  });

  let lambdaHome = homeSide.lambda;
  let lambdaAway = awaySide.lambda;
  let liveMeta: Record<string, number> = {};
  if (inputs.live && isLiveRecalc(inputs.live)) {
    const live = computeLiveLambdas({
      base_home: homeSide.lambda,
      base_away: awaySide.lambda,
      live: inputs.live,
    });
    lambdaHome = live.lambda_home;
    lambdaAway = live.lambda_away;
    liveMeta = live.meta;
  }

  const notes = [
    `formula=${FORMULA_VERSION}`,
    `park=${parkTime.toFixed(3)}`,
    `weather=${weather.toFixed(3)}`,
    `ump=${ump.toFixed(3)}`,
    `chaos=${chaos.toFixed(1)}`,
  ];
  if (inputs.live && inputs.live.completed_innings >= 1) {
    notes.push(`live_inn=${inputs.live.completed_innings}`);
  }

  return {
    lambda_home: lambdaHome,
    lambda_away: lambdaAway,
    chaos,
    notes,
    breakdown: {
      home: homeSide.breakdown,
      away: awaySide.breakdown,
      park_time: Math.round(parkTime * 10000) / 10000,
      weather: Math.round(weather * 10000) / 10000,
      ump: Math.round(ump * 10000) / 10000,
      base_lambda_home: Math.round(homeSide.lambda * 10000) / 10000,
      base_lambda_away: Math.round(awaySide.lambda * 10000) / 10000,
      live: liveMeta,
    },
  };
}

export function analyzeMatchup(
  inputs: MatchupInputs,
  markets?: MarketLine[] | null,
  opts?: { value_threshold?: number; overround?: number; n_main?: number },
): After5Analysis {
  const { lambda_home, lambda_away, chaos, notes, breakdown } =
    buildLambdas(inputs);
  const live = inputs.live;
  let sim: Record<string, number>;
  let simMode: string;
  let expectedHome: number;
  let expectedAway: number;

  if (live && isLiveRecalc(live)) {
    const liveSim = simulateLiveF5(lambda_home, lambda_away, live, {
      chaos,
      seed: inputs.seed ?? 42,
    });
    simMode = liveSim.mode ?? 'live_mc';
    sim = {
      p_home_lead: liveSim.p_home_lead,
      p_tie: liveSim.p_tie,
      p_away_lead: liveSim.p_away_lead,
      p_over_4_5: liveSim.p_over_4_5,
      avg_total: liveSim.avg_total,
    };
    const remaining = Math.max(
      1,
      remainingF5Innings(live.completed_innings, {
        inning: live.inning,
        inningHalf: live.inning_half,
      }),
    );
    expectedHome = live.home_score + lambda_home * remaining;
    expectedAway = live.away_score + lambda_away * remaining;
  } else {
    sim = simulateF5(lambda_home, lambda_away, {
      chaos,
      seed: inputs.seed ?? 42,
      n_main: opts?.n_main,
    });
    simMode = 'pregame_mc';
    expectedHome = lambda_home * 5;
    expectedAway = lambda_away * 5;
  }

  const valueRows = evaluateMarkets(sim, markets ?? [], {
    overround: opts?.overround,
  });
  const threshold = opts?.value_threshold ?? VALUE_THRESHOLD;
  return {
    lambda_home,
    lambda_away,
    expected_home_runs: expectedHome,
    expected_away_runs: expectedAway,
    expected_total: expectedHome + expectedAway,
    p_home_lead: sim.p_home_lead!,
    p_tie: sim.p_tie!,
    p_away_lead: sim.p_away_lead!,
    p_over_4_5: sim.p_over_4_5!,
    avg_total: sim.avg_total!,
    value_bets: valueRows.filter((b) => b.value_pct >= threshold),
    signals: [],
    notes,
    formula_version: FORMULA_VERSION,
    breakdown,
    simulation_mode: simMode,
  };
}

export function fixtureMatchupInputs(): MatchupInputs {
  return {
    home: {
      ...defaultTeamInputs(),
      ops: 0.78,
      sp_era: 3.8,
      barrel_pct: 0.1,
      hardhit_pct: 0.42,
    },
    away: {
      ...defaultTeamInputs(),
      ops: 0.7,
      sp_era: 4.2,
      barrel_pct: 0.08,
      hardhit_pct: 0.36,
    },
    venue: 'Yankee Stadium',
    temperature_f: 75,
    humidity: 55,
    wind_speed_mph: 8,
    wind_direction_deg: 0,
    day_night: 'night',
    ump_strike_zone_pct: 0.63,
    seed: 42,
  };
}
