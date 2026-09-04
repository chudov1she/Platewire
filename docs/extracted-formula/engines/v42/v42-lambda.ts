/** MLB After-5 v4.2 pure math blocks. */

export const LEAGUE_ERA = 4.5;
export const LEAGUE_OPS = 0.72;
export const LEAGUE_BARREL = 0.085;
export const LEAGUE_HARDHIT = 0.35;
export const LEAGUE_SPRINT = 27;
export const LEAGUE_GB = 0.42;
export const LAMBDA_MIN = 0.05;
export const LAMBDA_MAX = 1.5;

export type WeatherInputs = {
  temperature_f?: number | null;
  humidity?: number | null;
  wind_speed_mph?: number | null;
  wind_direction_deg?: number | null;
};

export type PitcherProfile = {
  era: number;
  fip?: number | null;
  era_last7?: number | null;
  ip_avg?: number | null;
  gb_pct: number;
  k_pct?: number | null;
  bb_pct?: number | null;
  fps_pct?: number | null;
};

export type TeamProfile = {
  ops: number;
  team_era: number;
  barrel_pct: number;
  hardhit_pct: number;
  gb_pct: number;
  sprint_speed: number;
  fielding_pct: number;
  oaa?: number | null;
  drs?: number | null;
  form_win_pct?: number | null;
  offense_trend?: number | null;
};

export type LiveF5State = {
  completed_innings: number;
  home_score: number;
  away_score: number;
  home_sp_pitches?: number | null;
  away_sp_pitches?: number | null;
  away_runs_inning1?: number | null;
  home_runs_inning1?: number | null;
  inning?: number | null;
  inning_half?: string | null;
  f5_complete?: boolean;
};

export function clampLambda(value: number): number {
  return Math.max(LAMBDA_MIN, Math.min(LAMBDA_MAX, value));
}

export function predictiveEra(opts: {
  era: number;
  fip?: number | null;
  era_last7?: number | null;
  ip_avg?: number | null;
  team_era?: number;
}): number {
  const parts: Array<[number, number]> = [[opts.era, 0.4]];
  if (opts.fip != null) parts.push([opts.fip, 0.35]);
  if (opts.era_last7 != null) parts.push([opts.era_last7, 0.25]);
  const weightSum = parts.reduce((s, [, w]) => s + w, 0);
  let pEra = parts.reduce((s, [v, w]) => s + v * w, 0) / weightSum;
  const sampleWeight = Math.min(1, (opts.ip_avg ?? 0) / 30);
  if (sampleWeight < 1) {
    const blend = (opts.team_era ?? 0) > 0 ? opts.team_era! : LEAGUE_ERA;
    pEra = pEra * sampleWeight + blend * (1 - sampleWeight);
  }
  return pEra;
}

export function fpsFactor(fpsPct: number | null | undefined): number {
  if (fpsPct == null) return 1;
  if (fpsPct >= 0.65) return 0.97;
  if (fpsPct <= 0.55) return 1.05;
  return 1;
}

export function firstInningMomentum(opts: {
  runs_allowed: number | null | undefined;
  pitches?: number | null;
}): number {
  if (opts.runs_allowed == null) return 1;
  if (opts.runs_allowed === 0 && (opts.pitches == null || opts.pitches <= 18)) {
    return 0.85;
  }
  if (opts.runs_allowed === 1) return 1.15;
  if (opts.runs_allowed >= 2) return 1.25;
  return 1;
}

export function speedBonus(sprintSpeed: number): number {
  return 1 + (sprintSpeed - LEAGUE_SPRINT) * 0.015;
}

export function mqiMultiplier(opts: {
  batter: TeamProfile;
  pitcher: PitcherProfile;
}): number {
  const { batter, pitcher } = opts;
  let mqi = 1;
  mqi += (batter.barrel_pct - LEAGUE_BARREL) * 0.6;
  mqi += (batter.hardhit_pct - LEAGUE_HARDHIT) * 0.35;
  if (pitcher.k_pct != null && pitcher.bb_pct != null) {
    mqi += (pitcher.k_pct - pitcher.bb_pct) * 0.02;
  }
  const speedPenalty = Math.max(0, (batter.sprint_speed - LEAGUE_SPRINT) * 0.01);
  const gidpTerm = batter.gb_pct * pitcher.gb_pct * (1 + speedPenalty);
  mqi -= gidpTerm * 0.15;
  if (pitcher.gb_pct >= 0.44) mqi *= 0.8;
  if (batter.barrel_pct >= 0.1) mqi *= 1.1;
  return Math.max(0.75, Math.min(1.35, mqi));
}

export function defenseAdj(opts: {
  fielding_pct: number;
  oaa?: number | null;
  drs?: number | null;
}): number {
  if (opts.oaa != null || opts.drs != null) {
    const oaaVal = opts.oaa ?? 0;
    const drsVal = opts.drs ?? 0;
    return Math.max(0.9, Math.min(1.1, 1 - oaaVal * 0.008 - drsVal * 0.006));
  }
  return Math.max(0.9, Math.min(1.05, 0.97 + (opts.fielding_pct - 0.985) * 2));
}

export function weatherWif(
  weather: WeatherInputs,
  opts?: { park_base?: number },
): number {
  const parkBase = opts?.park_base ?? 1;
  let tempMult = 1;
  if (weather.temperature_f != null) {
    const tempC = ((weather.temperature_f - 32) * 5) / 9;
    if (tempC > 25) tempMult = 1.02;
    else if (tempC < 10) tempMult = 0.98;
    else if (weather.temperature_f <= 63) tempMult = 0.95;
    else if (weather.temperature_f >= 86) tempMult = 1.1;
    else {
      tempMult =
        0.95 + ((weather.temperature_f - 63) * (1.1 - 0.95)) / (86 - 63);
    }
  }
  const humidityMult =
    weather.humidity != null && weather.humidity > 80 ? 1.03 : 1;
  let windMult = 1;
  if (weather.wind_speed_mph != null && weather.wind_speed_mph > 0) {
    const direction = weather.wind_direction_deg ?? 0;
    const tail = Math.cos((direction * Math.PI) / 180);
    windMult = 1 + (weather.wind_speed_mph / 10) * tail / 20;
    windMult = Math.max(0.92, Math.min(1.08, windMult));
  }
  return Math.max(0.9, Math.min(1.15, tempMult * humidityMult * windMult * parkBase));
}

export function umpireUif(
  strikeZonePct: number | null | undefined,
  accuracyAboveX?: number | null,
): number {
  // Prefer zone-quality signal from UmpScorecards when present.
  if (accuracyAboveX != null && Number.isFinite(accuracyAboveX)) {
    if (accuracyAboveX >= 1) return 0.98;
    if (accuracyAboveX <= -1) return 1.04;
  }
  if (strikeZonePct == null) return 1;
  if (strikeZonePct > 0.66) return 0.97;
  if (strikeZonePct < 0.6) return 1.05;
  return 1;
}

export function parkTimeFactor(opts: {
  venue?: string | null;
  day_night?: string | null;
  park_base: number;
}): number {
  const key = (opts.venue || '').toLowerCase();
  const night = ['night', 'n', 'pm'].includes((opts.day_night || '').toLowerCase());
  const day =
    !night && ['day', 'd', 'am'].includes((opts.day_night || '').toLowerCase());
  if (key.includes('coors')) return opts.park_base * (day ? 1.1 : 1);
  if (key.includes('wrigley') && day) return opts.park_base * 1.05;
  if (key.includes('petco') && night) return opts.park_base * 0.95;
  if (key.includes('oracle') && night) return opts.park_base * 0.92;
  return opts.park_base;
}

export function tttoFactorF5(): number {
  return 1.015;
}

export function hrRiskFactor(opts: {
  sp_gb_pct: number;
  barrel_pct: number;
  hardhit_pct: number;
}): number {
  const hrRisk = (1 - opts.sp_gb_pct) * opts.barrel_pct * opts.hardhit_pct;
  if (hrRisk > 0.013) return Math.min(1.08, 1 + (hrRisk - 0.013) * 3);
  return 1;
}

export function offenseTrendFactor(trend: number | null | undefined): number {
  if (trend == null) return 1;
  if (trend > 1.1) return 1 + (trend - 1) * 0.15;
  if (trend < 0.85) return 1 - (1 - trend) * 0.1;
  return 1;
}

export function formFactor(formWinPct: number | null | undefined): number {
  if (formWinPct == null) return 1;
  return 0.9 + formWinPct * 0.2;
}

export function fatigueBurst(opts: {
  pitches?: number | null;
  inning: number;
  lineup_pass?: number;
}): number {
  if (opts.pitches == null || opts.pitches < 70) return 1;
  if (opts.inning >= 4 || (opts.lineup_pass ?? 1) >= 3) {
    const frac = Math.min(1, (opts.pitches - 70) / 14);
    return 1.18 + frac * (1.25 - 1.18);
  }
  return 1;
}

export function pitcherFatigueMultiplier(
  pitches: number | null | undefined,
): number {
  if (pitches == null) return 1;
  return Math.max(0.7, 1 - (pitches / 500) * 3);
}

export function buildSideLambda(opts: {
  offense: TeamProfile;
  defense: TeamProfile;
  opposing_pitcher: PitcherProfile;
  park_time: number;
  weather_factor: number;
  ump_factor: number;
  momentum?: number;
  h2h_edge?: number;
}): { lambda: number; breakdown: Record<string, number> } {
  const momentum = opts.momentum ?? 1;
  const h2hEdge = opts.h2h_edge ?? 1;
  const pEra = predictiveEra({
    era: opts.opposing_pitcher.era,
    fip: opts.opposing_pitcher.fip,
    era_last7: opts.opposing_pitcher.era_last7,
    ip_avg: opts.opposing_pitcher.ip_avg,
    team_era: opts.defense.team_era,
  });
  const eraAdj =
    (pEra / LEAGUE_ERA) *
    opts.park_time *
    opts.weather_factor *
    opts.ump_factor *
    fpsFactor(opts.opposing_pitcher.fps_pct);
  const bat =
    (opts.offense.ops / LEAGUE_OPS) * speedBonus(opts.offense.sprint_speed);
  const matchup = mqiMultiplier({
    batter: opts.offense,
    pitcher: opts.opposing_pitcher,
  });
  const dAdj = defenseAdj({
    fielding_pct: opts.defense.fielding_pct,
    oaa: opts.defense.oaa,
    drs: opts.defense.drs,
  });
  const liveAdj =
    formFactor(opts.offense.form_win_pct) *
    offenseTrendFactor(opts.offense.offense_trend) *
    h2hEdge *
    momentum *
    tttoFactorF5() *
    hrRiskFactor({
      sp_gb_pct: opts.opposing_pitcher.gb_pct,
      barrel_pct: opts.offense.barrel_pct,
      hardhit_pct: opts.offense.hardhit_pct,
    });
  const lambda = clampLambda(0.5 * bat * eraAdj * matchup * dAdj * liveAdj);
  return {
    lambda,
    breakdown: {
      p_era: Math.round(pEra * 1000) / 1000,
      era_adj: Math.round(eraAdj * 10000) / 10000,
      bat: Math.round(bat * 10000) / 10000,
      matchup: Math.round(matchup * 10000) / 10000,
      defense: Math.round(dAdj * 10000) / 10000,
      live_adj: Math.round(liveAdj * 10000) / 10000,
      momentum: Math.round(momentum * 1000) / 1000,
    },
  };
}

export function computeLiveLambdas(opts: {
  base_home: number;
  base_away: number;
  live: LiveF5State;
}): {
  lambda_home: number;
  lambda_away: number;
  meta: Record<string, number>;
} {
  const { live } = opts;
  const momHome = firstInningMomentum({
    runs_allowed: live.home_runs_inning1,
    pitches: live.home_sp_pitches,
  });
  const momAway = firstInningMomentum({
    runs_allowed: live.away_runs_inning1,
    pitches: live.away_sp_pitches,
  });
  const fatigueHomeSp = pitcherFatigueMultiplier(live.home_sp_pitches);
  const fatigueAwaySp = pitcherFatigueMultiplier(live.away_sp_pitches);

  let adjHome = opts.base_home * momAway;
  let adjAway = opts.base_away * momHome;
  adjHome *= 2 - fatigueAwaySp;
  adjAway *= 2 - fatigueHomeSp;

  const burstHome = fatigueBurst({
    pitches: live.away_sp_pitches,
    inning: live.completed_innings,
  });
  const burstAway = fatigueBurst({
    pitches: live.home_sp_pitches,
    inning: live.completed_innings,
  });
  adjHome *= burstHome;
  adjAway *= burstAway;

  return {
    lambda_home: clampLambda(adjHome),
    lambda_away: clampLambda(adjAway),
    meta: {
      mom_home_from_away_sp: momAway,
      mom_away_from_home_sp: momHome,
      fatigue_home_sp: fatigueHomeSp,
      fatigue_away_sp: fatigueAwaySp,
      burst_home: burstHome,
      burst_away: burstAway,
    },
  };
}

export function poissonPmf(k: number, lam: number): number {
  if (lam <= 0) return k === 0 ? 1 : 0;
  let logFact = 0;
  for (let i = 2; i <= k; i += 1) logFact += Math.log(i);
  return Math.exp(-lam + k * Math.log(lam) - logFact);
}

export function exactPoissonF5(opts: {
  lambda_home: number;
  lambda_away: number;
  remaining_innings: number;
  base_home: number;
  base_away: number;
  max_runs?: number;
}): Record<string, number> {
  const maxRuns = opts.max_runs ?? 12;
  const lamHomeTotal = Math.max(0.01, opts.lambda_home * opts.remaining_innings);
  const lamAwayTotal = Math.max(0.01, opts.lambda_away * opts.remaining_innings);
  const homePmf = Array.from({ length: maxRuns + 1 }, (_, k) =>
    poissonPmf(k, lamHomeTotal),
  );
  const awayPmf = Array.from({ length: maxRuns + 1 }, (_, k) =>
    poissonPmf(k, lamAwayTotal),
  );
  let pHome = 0;
  let pTie = 0;
  let pAway = 0;
  let pOver = 0;
  let totalWeight = 0;
  for (let homeAdd = 0; homeAdd <= maxRuns; homeAdd += 1) {
    for (let awayAdd = 0; awayAdd <= maxRuns; awayAdd += 1) {
      const weight = homePmf[homeAdd]! * awayPmf[awayAdd]!;
      totalWeight += weight;
      const finalHome = opts.base_home + homeAdd;
      const finalAway = opts.base_away + awayAdd;
      const margin = finalAway - finalHome;
      if (margin > 0.5) pAway += weight;
      else if (margin < -0.5) pHome += weight;
      else pTie += weight;
      if (finalHome + finalAway > 4.5) pOver += weight;
    }
  }
  if (totalWeight <= 0) {
    return {
      p_home_lead: 0.33,
      p_tie: 0.34,
      p_away_lead: 0.33,
      p_over_4_5: 0.5,
      avg_total: 4.5,
    };
  }
  return {
    p_home_lead: pHome / totalWeight,
    p_tie: pTie / totalWeight,
    p_away_lead: pAway / totalWeight,
    p_over_4_5: pOver / totalWeight,
    avg_total:
      opts.base_home + opts.base_away + lamHomeTotal + lamAwayTotal,
  };
}
