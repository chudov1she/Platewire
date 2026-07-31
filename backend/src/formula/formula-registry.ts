import type { MatchupInputs } from './formula.types.js';

/** Numeric env exposed to derived/lambda_*_mult expressions in FormulaSpec. */
export function buildFormulaEnv(
  inputs: MatchupInputs,
  opts: {
    base_lambda_home: number;
    base_lambda_away: number;
    breakdown: Record<string, unknown>;
  },
): Record<string, number> {
  const home = inputs.home;
  const away = inputs.away;
  const env: Record<string, number> = {
    base_lambda_home: opts.base_lambda_home,
    base_lambda_away: opts.base_lambda_away,
    home_ops: home.ops,
    away_ops: away.ops,
    home_sp_era: home.sp_era,
    away_sp_era: away.sp_era,
    home_sp_fip: home.sp_fip ?? home.sp_era,
    away_sp_fip: away.sp_fip ?? away.sp_era,
    home_sp_ip_avg: home.sp_ip_avg ?? 5.5,
    away_sp_ip_avg: away.sp_ip_avg ?? 5.5,
    home_team_era: home.team_era,
    away_team_era: away.team_era,
    home_barrel_pct: home.barrel_pct,
    away_barrel_pct: away.barrel_pct,
    home_gb_pct: home.gb_pct,
    away_gb_pct: away.gb_pct,
    weather_temp_f: inputs.temperature_f ?? 72,
    weather_humidity: inputs.humidity ?? 50,
    weather_wind_mph: inputs.wind_speed_mph ?? 0,
    ump_strike_zone_pct: inputs.ump_strike_zone_pct ?? 50,
    ump_accuracy_above_x: inputs.ump_accuracy_above_x ?? 0,
    ump_consistency: inputs.ump_consistency ?? 0,
    ump_favor_abs: inputs.ump_favor_abs ?? 0,
    ump_run_impact: inputs.ump_run_impact ?? 0,
    h2h_home_edge: inputs.h2h_home_edge ?? 1,
    park_time: Number(opts.breakdown.park_time ?? 1),
    weather_factor: Number(opts.breakdown.weather ?? 1),
    ump_factor: Number(opts.breakdown.ump ?? 1),
  };
  const live = inputs.live;
  if (live) {
    env.live_home_score = live.home_score;
    env.live_away_score = live.away_score;
    env.live_completed_innings = live.completed_innings;
  }
  return env;
}

export function registryCatalog(): Array<{ name: string; desc: string }> {
  return [
    { name: 'base_lambda_home', desc: 'λ home before user multipliers' },
    { name: 'base_lambda_away', desc: 'λ away before user multipliers' },
    { name: 'home_ops', desc: 'Home team OPS' },
    { name: 'away_ops', desc: 'Away team OPS' },
    { name: 'home_sp_era', desc: 'Home starter ERA' },
    { name: 'away_sp_era', desc: 'Away starter ERA' },
    { name: 'home_sp_fip', desc: 'Home starter FIP' },
    { name: 'away_sp_fip', desc: 'Away starter FIP' },
    { name: 'home_sp_ip_avg', desc: 'Home starter avg IP' },
    { name: 'away_sp_ip_avg', desc: 'Away starter avg IP' },
    { name: 'home_team_era', desc: 'Home team ERA' },
    { name: 'away_team_era', desc: 'Away team ERA' },
    { name: 'home_barrel_pct', desc: 'Home barrel %' },
    { name: 'away_barrel_pct', desc: 'Away barrel %' },
    { name: 'home_gb_pct', desc: 'Home GB %' },
    { name: 'away_gb_pct', desc: 'Away GB %' },
    { name: 'weather_temp_f', desc: 'Temperature °F' },
    { name: 'weather_humidity', desc: 'Humidity %' },
    { name: 'weather_wind_mph', desc: 'Wind speed mph' },
    { name: 'ump_strike_zone_pct', desc: 'Umpire called-strike rate' },
    { name: 'ump_accuracy_above_x', desc: 'UmpScorecards accuracy vs expected' },
    { name: 'ump_consistency', desc: 'UmpScorecards consistency %' },
    { name: 'ump_favor_abs', desc: 'UmpScorecards absolute favor' },
    { name: 'ump_run_impact', desc: 'UmpScorecards mean run impact' },
    { name: 'h2h_home_edge', desc: 'H2H home edge multiplier' },
    { name: 'park_time', desc: 'Park/time factor from v42' },
    { name: 'weather_factor', desc: 'Weather WIF from v42' },
    { name: 'ump_factor', desc: 'Umpire factor from v42' },
    { name: 'live_home_score', desc: 'Live home score (F5 window)' },
    { name: 'live_away_score', desc: 'Live away score (F5 window)' },
    { name: 'live_completed_innings', desc: 'Live elapsed F5 innings' },
  ];
}

export function availableEnvKeys(): string[] {
  return registryCatalog().map((item) => item.name);
}
